import * as THREE from 'three';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import type { BrickDefinition } from '../bricks/types';

/**
 * LDraw coordinate system:
 * - 1 stud = 20 LDU
 * - 1 plate height = 8 LDU
 * - Y axis is inverted (-Y is up in LDraw)
 *
 * We scale by 1/20 = 0.05 and negate Y to convert to our stud-based coordinate system.
 */
const LDRAW_SCALE = 0.05;

export class LDrawPartLoader {
  private cache = new Map<string, THREE.Group>();
  private loader: LDrawLoader;
  private _ready = false;

  constructor() {
    this.loader = new LDrawLoader(new THREE.LoadingManager());
    this.loader.smoothNormals = true;
  }

  /**
   * Initialize the loader with either embedded file data or a library path.
   * Must be called before getTemplate/createColoredClone.
   */
  async init(opts: {
    embeddedFiles?: Record<string, string>;
    libraryPath?: string;
  }): Promise<void> {
    if (opts.embeddedFiles && Object.keys(opts.embeddedFiles).length > 0) {
      this.initEmbedded(opts.embeddedFiles);
    } else if (opts.libraryPath) {
      this.loader.setPartsLibraryPath(opts.libraryPath);
    }

    // Preload materials from LDConfig.ldr
    try {
      await this.loader.preloadMaterials('LDConfig.ldr');
    } catch (e) {
      console.warn('LDrawPartLoader: Could not preload LDConfig.ldr, using default colors', e);
    }

    this._ready = true;
  }

  private initEmbedded(files: Record<string, string>): void {
    // Create blob URLs for each embedded file and set up a file map
    const fileMap: Record<string, string> = {};

    for (const [filePath, content] of Object.entries(files)) {
      const blob = new Blob([content], { type: 'text/plain' });
      const blobUrl = URL.createObjectURL(blob);
      // LDrawLoader expects lowercase paths
      fileMap[filePath.toLowerCase()] = blobUrl;
    }

    // Custom loading manager that resolves from our blob URLs
    const manager = new THREE.LoadingManager();

    // Set the loader's manager and configure URL resolution
    this.loader.manager = manager;

    // Override the file map for the loader
    (this.loader as any).fileMap = fileMap;

    manager.setURLModifier((url: string) => {
      // Normalize the URL to a relative path
      const normalized = url
        .replace(/^.*\/ldraw\//, '')
        .replace(/^\.\//, '')
        .toLowerCase();

      if (fileMap[normalized]) {
        return fileMap[normalized];
      }

      // Try with parts/ or p/ prefix
      for (const prefix of ['parts/', 'p/', 'parts/s/', 'p/48/', 'p/8/']) {
        const prefixed = prefix + normalized;
        if (fileMap[prefixed]) {
          return fileMap[prefixed];
        }
      }

      // Try without prefix
      const baseName = normalized.split('/').pop()!;
      for (const [key, blobUrl] of Object.entries(fileMap)) {
        if (key.endsWith('/' + baseName) || key === baseName) {
          return blobUrl;
        }
      }

      return url;
    });
  }

  isReady(): boolean {
    return this._ready;
  }

  /**
   * Load and cache an LDraw part template.
   * Returns null if the part can't be loaded.
   */
  async loadPart(partId: string): Promise<THREE.Group | null> {
    if (this.cache.has(partId)) {
      return this.cache.get(partId)!;
    }

    try {
      const group = await this.loader.loadAsync(`parts/${partId}.dat`) as THREE.Group;
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

    // Apply origin shift: LDraw parts are centered on their origin,
    // but our system uses corner-origin (0,0 is the min corner).
    // The LDraw template is already scaled, so shift by half the brick size
    // in stud units (which equals world units since STUD_SIZE=1).
    clone.position.set(def.studsX * 0.5, 0, def.studsZ * 0.5);

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
