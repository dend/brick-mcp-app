import * as THREE from 'three';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js';
import type { BrickDefinition } from '../bricks/types';
import { PLATE_HEIGHT } from '../constants';

/**
 * LDraw coordinate system:
 * - 1 stud = 20 LDU
 * - 1 plate height = 8 LDU
 * - Y axis is inverted (-Y is up in LDraw)
 *
 * We scale by 1/20 = 0.05 and negate Y to convert to our stud-based coordinate system.
 *
 * File loading: the MCP App iframe inside Claude has no HTTP origin and CSP blocks
 * fetch() of blob:/data: URLs, so three's FileLoader can't be used at all. Instead
 * we pull .dat text through the MCP tool channel (brick_get_ldraw_files returns a
 * part + every transitive subfile) and hand the strings straight to LDrawLoader:
 *   - LDrawParsedCache.setData(path, text) pre-seeds the internal dep cache; when
 *     processIntoMesh later recurses into a subfile, ensureDataLoaded() finds it
 *     already present and skips the fetchData() network path entirely.
 *   - loader.fileMap maps the as-written subfile reference (e.g. "stud.dat",
 *     "s/79180s01.dat") to the canonical key we used with setData.
 *   - loader.parse(text) is the top-level entry — takes a string, no URL.
 * No fetch() call is ever made, so CSP never fires.
 */
const LDRAW_SCALE = 0.05;

// LDrawLoader's internals aren't in its .d.ts; these are the bits we reach into.
interface LDrawParseCache { setData(fileName: string, text: string): void }
interface LDrawLoaderInternals {
  fileMap: Record<string, string>;
  partsCache: { parseCache: LDrawParseCache };
}

export type LDrawFileFetcher = (partId: string) => Promise<Record<string, string> | null>;

export class LDrawPartLoader {
  private cache = new Map<string, THREE.Group>();
  private inflight = new Map<string, Promise<THREE.Group | null>>();
  private loader: LDrawLoader;
  private seeded = new Set<string>(); // canonical paths already handed to setData
  private fetcher: LDrawFileFetcher | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private _ready = false;

  constructor() {
    this.loader = new LDrawLoader();
    this.loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    this.loader.smoothNormals = true;
  }

  /**
   * Hand every dep's text to LDrawLoader's parse cache and wire the
   * as-written → canonical key mapping so subfile recursion finds them.
   * LDrawLoader.js:915 reads fileMap[ref] before searching; :1145 skips
   * fetchData when the key is already in _cache.
   *
   * Two passes because setData() synchronously runs parse(), which reads
   * fileMap for every line-1 reference — so fileMap must be fully populated
   * before ANY setData runs, not after each one.
   */
  private ingestFiles(files: Record<string, string>): void {
    const internals = this.loader as unknown as LDrawLoaderInternals;
    const parseCache = internals.partsCache.parseCache;
    const fileMap = internals.fileMap;

    const fresh: [string, string][] = [];
    for (const [relPath, content] of Object.entries(files)) {
      const canonical = relPath.replace(/\\/g, '/');
      if (this.seeded.has(canonical)) continue;
      this.seeded.add(canonical);
      fresh.push([canonical, content]);

      // Map every form the .dat source might reference this file by.
      // Line-1 parser at LDrawLoader.js:915 does `replace(/\\/g, '/')` then
      // checks fileMap, so we index both the bare basename and the path
      // without its top-level dir (parts/s/foo → s/foo, p/48/foo → 48/foo).
      const base = canonical.split('/').pop()!;
      fileMap[base] = canonical;
      fileMap[canonical] = canonical;
      const slash = canonical.indexOf('/');
      if (slash !== -1) {
        fileMap[canonical.slice(slash + 1)] = canonical;
      }
    }

    for (const [canonical, content] of fresh) {
      parseCache.setData(canonical, content);
    }
  }

  /**
   * Provide the function that fetches .dat file bundles from the server.
   * Call this before loadPart().
   */
  init(fetcher: LDrawFileFetcher): void {
    this.fetcher = fetcher;
    this._ready = true;
  }

  isReady(): boolean {
    return this._ready;
  }

  /**
   * Load and cache an LDraw part template.
   * Returns null if the part can't be loaded.
   */
  loadPart(partId: string): Promise<THREE.Group | null> {
    const cached = this.cache.get(partId);
    if (cached) return Promise.resolve(cached);

    const inflight = this.inflight.get(partId);
    if (inflight) return inflight;

    // Serialize fetch→ingest→parse so fileMap and parseCache aren't observed
    // mid-population by a concurrent part's parse. setData() runs parse()
    // synchronously, so once this._doLoad settles the shared state is clean.
    const task = this.chain.then(() => this._doLoad(partId));
    this.chain = task.catch(() => {});
    this.inflight.set(partId, task);
    task.finally(() => this.inflight.delete(partId));
    return task;
  }

  private async _doLoad(partId: string): Promise<THREE.Group | null> {
    if (this.cache.has(partId)) return this.cache.get(partId)!;
    if (!this.fetcher) return null;

    const partKey = `parts/${partId}.dat`;

    const files = await this.fetcher(partId);
    if (!files || !files[partKey]) return null;
    this.ingestFiles(files);

    try {
      // loader.parse() takes raw text — no URL, no FileLoader, no fetch.
      // All subfile deps were seeded via setData above, so processIntoMesh
      // finds them in-cache and never calls fetchData().
      // LDConfig color codes are irrelevant: createColoredClone replaces
      // every material with the brick's picked color anyway.
      const group = await new Promise<THREE.Group>((resolve, reject) => {
        this.loader.parse(files[partKey], resolve, reject);
      });
      const template = this.prepareTemplate(group, partId);
      this.cache.set(partId, template);
      return template;
    } catch (e) {
      console.warn(`LDrawPartLoader: Failed to load part ${partId}`, e);
      return null;
    }
  }

  /**
   * Get a cached template. Returns null if not loaded yet.
   */
  getTemplate(partId: string): THREE.Group | null {
    return this.cache.get(partId) ?? null;
  }

  /**
   * Prepare an LDraw-loaded group for use in our coordinate system.
   * - Wraps in a container with scale/position transforms
   * - Removes ConditionalLineSegments (optional edge lines)
   */
  private prepareTemplate(group: THREE.Group, _partId: string): THREE.Group {
    const container = new THREE.Group();
    container.add(group);

    // Scale from LDU to stud units and flip Y axis
    // LDraw: 1 stud = 20 LDU, -Y is up
    container.scale.set(LDRAW_SCALE, -LDRAW_SCALE, LDRAW_SCALE);

    // Rotate -90° around Y to align LDraw axes with our convention:
    // LDraw X (width) → scene Z (studsZ), LDraw Z (depth) → scene X (studsX)
    container.rotation.y = -Math.PI / 2;

    // Remove ConditionalLineSegments — they're decorative edge hints
    const toRemove: THREE.Object3D[] = [];
    container.traverse((child) => {
      if ((child as any).isConditionalLine) {
        toRemove.push(child);
      }
    });
    for (const obj of toRemove) {
      obj.parent?.remove(obj);
    }

    // Compute world-space bounding box for accurate corner-origin positioning.
    // X/Z are needed because LDraw geometry is not always centered at its origin
    // (e.g. 6084 has Z∈[-30,42], center=+6) so studs*0.5 would misalign the mesh.
    container.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(container);
    container.userData.geoBbox = {
      minX: bbox.min.x, minY: bbox.min.y, minZ: bbox.min.z, maxY: bbox.max.y,
    };

    return container;
  }

  /**
   * Create a colored clone of a loaded template.
   * Each clone gets fresh materials so colors can be set independently.
   */
  createColoredClone(
    partId: string,
    def: BrickDefinition,
    color: string,
  ): THREE.Object3D | null {
    const template = this.cache.get(partId);
    if (!template) return null;

    const clone = template.clone();

    // Shift mesh so its min corner lands at local (0,0,0). applyBrickTransform
    // then places that corner at the grid cell's world position.
    const bbox = template.userData.geoBbox as { minX: number; minY: number; minZ: number; maxY: number } | undefined;
    if (bbox) {
      clone.position.set(-bbox.minX, -bbox.minY, -bbox.minZ);
    } else {
      clone.position.set(def.studsX * 0.5, def.heightUnits * PLATE_HEIGHT, def.studsZ * 0.5);
    }

    // Override materials with our color
    const threeColor = new THREE.Color(color);
    const edgeColor = new THREE.Color(color).multiplyScalar(0.5);

    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: threeColor,
          roughness: 0.6,
          metalness: 0.1,
          side: THREE.DoubleSide,  // Needed because negative Y scale flips winding
        });
        child.castShadow = true;
        child.receiveShadow = true;
      } else if (child instanceof THREE.LineSegments) {
        child.material = new THREE.LineBasicMaterial({ color: edgeColor });
      }
    });

    return clone;
  }

  /**
   * Preload all parts from the catalog.
   */
  async preloadParts(partIds: string[]): Promise<void> {
    const promises = partIds.map(id => this.loadPart(id));
    await Promise.allSettled(promises);
  }
}

// Singleton instance
export const ldrawPartLoader = new LDrawPartLoader();
