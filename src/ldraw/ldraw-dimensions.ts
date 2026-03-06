import fsSync from "node:fs";
import path from "node:path";
import type { BrickDefinition } from "../bricks/types.js";

let ldrawDir = "";

export function setLDrawDir(dir: string): void {
  ldrawDir = dir;
}

const cache = new Map<string, BrickDefinition | null>();

/**
 * Parse an LDraw part file and return its dimensions as a BrickDefinition.
 * Uses name-based parsing first (fast), falls back to geometry bounding box.
 */
export function parseLDrawPart(partId: string): BrickDefinition | null {
  if (cache.has(partId)) return cache.get(partId)!;
  const result = doParse(partId);
  cache.set(partId, result);
  return result;
}

// LDraw unit constants
const LDU_PER_STUD = 20;
const LDU_PER_PLATE = 8;
const STUD_PROTRUSION_LDU = 4;

function doParse(partId: string): BrickDefinition | null {
  if (!ldrawDir) return null;

  const filePath = path.join(ldrawDir, "parts", `${partId}.dat`);
  if (!fsSync.existsSync(filePath)) return null;

  // Read header to get part name
  const fd = fsSync.openSync(filePath, "r");
  const buf = Buffer.alloc(2048);
  const bytesRead = fsSync.readSync(fd, buf, 0, 2048, 0);
  fsSync.closeSync(fd);

  const header = buf.toString("utf8", 0, bytesRead);
  const headerLines = header.split("\n");

  const descLine = headerLines[0]?.trim() ?? "";
  if (!descLine.startsWith("0 ")) return null;
  const name = descLine.slice(2).trim();

  // Try name-based dimension parsing for studsX/studsZ (reliable from name)
  const dims = parseDimensionsFromName(name);
  // Always compute geometry bounding box for accurate height
  const bbox = computeBoundingBox(filePath, new Set());

  if (!dims && !bbox) return null;

  // studsX/studsZ from name (reliable), fallback to geometry
  const studsX = dims?.studsX ?? Math.max(1, Math.round((bbox!.maxX - bbox!.minX) / LDU_PER_STUD));
  const studsZ = dims?.studsZ ?? Math.max(1, Math.round((bbox!.maxZ - bbox!.minZ) / LDU_PER_STUD));

  // heightUnits: prefer geometry (accurate for non-standard parts), fallback to name-parsed
  let heightUnits: number;
  if (bbox) {
    const yExtent = bbox.maxY - bbox.minY;
    heightUnits = Math.max(
      1,
      Math.round(Math.max(0, yExtent - STUD_PROTRUSION_LDU) / LDU_PER_PLATE),
    );
  } else {
    heightUnits = dims!.heightUnits;
  }

  // Compute sparse occupancy map for non-rectangular parts
  const occupancyMap = bbox
    ? computeOccupancyMap(filePath, bbox, studsX, studsZ, heightUnits)
    : undefined;

  return { id: partId, name, studsX, studsZ, heightUnits, occupancyMap };
}

/**
 * Extract dimensions from LDraw part name patterns:
 *   "Brick 2 x 4"         → 2×4 studs, height=3 plates
 *   "Plate 1 x 2"         → 1×2 studs, height=1 plate
 *   "Tile 1 x 1"          → 1×1 studs, height=1 plate
 *   "Slope 45 2 x 2"      → 2×2 studs, height=3 plates
 *   "Brick 1 x 2 x 5"     → 1×2 studs, height=15 plates (5 brick heights)
 *   "Technic Brick 1 x 4"  → 1×4 studs, height=3 plates
 */
function parseDimensionsFromName(
  name: string,
): {
  studsX: number;
  studsZ: number;
  heightUnits: number;
  heightSource: "explicit" | "default";
} | null {
  const dimMatch = name.match(
    /(\d+)\s*x\s*(\d+)(?:\s*x\s*(\d+(?:\.\d+)?))?/i,
  );
  if (!dimMatch) return null;

  const d1 = parseInt(dimMatch[1], 10);
  const d2 = parseInt(dimMatch[2], 10);
  const d3 = dimMatch[3] ? parseFloat(dimMatch[3]) : null;

  if (isNaN(d1) || isNaN(d2) || d1 <= 0 || d2 <= 0) return null;

  const upper = name.toUpperCase();
  const isPlateOrTile =
    upper.includes("PLATE") ||
    upper.includes("TILE") ||
    upper.includes("BASEPLATE");

  // Parts that use plate-height units in their name's 3rd dimension
  const usesPlateHeight =
    isPlateOrTile ||
    upper.includes("BRACKET") ||
    upper.includes("ANGLE PLATE") ||
    upper.includes("HINGE") ||
    upper.includes("JUMPER");

  let heightUnits: number;
  let heightSource: "explicit" | "default";
  if (d3 !== null && d3 > 0) {
    // Explicit height dimension
    heightUnits = usesPlateHeight
      ? Math.round(d3)
      : Math.round(d3 * 3);
    heightSource = "explicit";
  } else if (isPlateOrTile) {
    heightUnits = 1;
    heightSource = "default";
  } else {
    // Default: standard brick height (3 plates)
    heightUnits = 3;
    heightSource = "default";
  }

  return { studsX: d1, studsZ: d2, heightUnits, heightSource };
}

// ── Geometry-based bounding box (fallback) ──────────────────────────────────

interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

const bboxCache = new Map<string, BoundingBox | null>();

function computeBoundingBox(
  filePath: string,
  ancestors: Set<string>,
): BoundingBox | null {
  const resolved = path.resolve(filePath);

  if (ancestors.has(resolved)) return null;
  if (bboxCache.has(resolved)) return bboxCache.get(resolved)!;

  if (!fsSync.existsSync(resolved)) {
    bboxCache.set(resolved, null);
    return null;
  }

  ancestors.add(resolved);

  const content = fsSync.readFileSync(resolved, "utf-8");
  const lines = content.split("\n");

  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;
  let hasPoints = false;

  function addPoint(x: number, y: number, z: number) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    hasPoints = true;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    const type = parseInt(parts[0], 10);

    if (type === 1 && parts.length >= 15) {
      // Sub-file reference: 1 colour x y z a b c d e f g h i file
      const tx = parseFloat(parts[2]);
      const ty = parseFloat(parts[3]);
      const tz = parseFloat(parts[4]);
      const a = parseFloat(parts[5]),
        b = parseFloat(parts[6]),
        c = parseFloat(parts[7]);
      const d = parseFloat(parts[8]),
        e = parseFloat(parts[9]),
        f = parseFloat(parts[10]);
      const g = parseFloat(parts[11]),
        h = parseFloat(parts[12]),
        i = parseFloat(parts[13]);
      const subFile = parts.slice(14).join(" ");

      const subPath = resolveSubFile(resolved, subFile);
      if (!subPath) continue;

      const subBox = computeBoundingBox(subPath, ancestors);
      if (!subBox) continue;

      // Transform all 8 corners of the sub-file bounding box
      for (const sx of [subBox.minX, subBox.maxX]) {
        for (const sy of [subBox.minY, subBox.maxY]) {
          for (const sz of [subBox.minZ, subBox.maxZ]) {
            addPoint(
              tx + a * sx + b * sy + c * sz,
              ty + d * sx + e * sy + f * sz,
              tz + g * sx + h * sy + i * sz,
            );
          }
        }
      }
    } else if (type === 3 && parts.length >= 11) {
      // Triangle
      addPoint(
        parseFloat(parts[2]),
        parseFloat(parts[3]),
        parseFloat(parts[4]),
      );
      addPoint(
        parseFloat(parts[5]),
        parseFloat(parts[6]),
        parseFloat(parts[7]),
      );
      addPoint(
        parseFloat(parts[8]),
        parseFloat(parts[9]),
        parseFloat(parts[10]),
      );
    } else if (type === 4 && parts.length >= 14) {
      // Quad
      addPoint(
        parseFloat(parts[2]),
        parseFloat(parts[3]),
        parseFloat(parts[4]),
      );
      addPoint(
        parseFloat(parts[5]),
        parseFloat(parts[6]),
        parseFloat(parts[7]),
      );
      addPoint(
        parseFloat(parts[8]),
        parseFloat(parts[9]),
        parseFloat(parts[10]),
      );
      addPoint(
        parseFloat(parts[11]),
        parseFloat(parts[12]),
        parseFloat(parts[13]),
      );
    } else if (type === 2 && parts.length >= 8) {
      // Line
      addPoint(
        parseFloat(parts[2]),
        parseFloat(parts[3]),
        parseFloat(parts[4]),
      );
      addPoint(
        parseFloat(parts[5]),
        parseFloat(parts[6]),
        parseFloat(parts[7]),
      );
    }
  }

  ancestors.delete(resolved);

  const result = hasPoints
    ? { minX, maxX, minY, maxY, minZ, maxZ }
    : null;
  bboxCache.set(resolved, result);
  return result;
}

// ── Geometry voxelization (sparse occupancy map) ─────────────────────────────

const occupancyCache = new Map<string, { dx: number; dy: number; dz: number }[] | undefined>();

/**
 * Compute a sparse occupancy map by voxelizing the part's geometry.
 * Returns relative cell offsets {dx, dy, dz} in scene coordinates, or
 * undefined if the part fills its full bounding box (standard rectangular).
 *
 * Coordinate mapping (LDraw → scene after -90° Y rotation):
 *   scene dx (studsX) = LDraw Z axis
 *   scene dz (studsZ) = LDraw X axis
 *   scene dy (height)  = -LDraw Y axis (inverted)
 */
function computeOccupancyMap(
  filePath: string,
  bbox: BoundingBox,
  studsX: number,
  studsZ: number,
  heightUnits: number,
): { dx: number; dy: number; dz: number }[] | undefined {
  const resolved = path.resolve(filePath);
  if (occupancyCache.has(resolved)) return occupancyCache.get(resolved);

  const totalCells = studsX * studsZ * heightUnits;
  // Skip voxelization for tiny parts — not worth the effort
  if (totalCells <= 3) {
    occupancyCache.set(resolved, undefined);
    return undefined;
  }

  const triangles = collectTriangles(filePath, [0,0,0, 1,0,0, 0,1,0, 0,0,1], new Set());
  if (triangles.length === 0) {
    occupancyCache.set(resolved, undefined);
    return undefined;
  }

  const occupiedCells = new Set<string>();

  // Map a LDraw coordinate to scene cell offset
  function toCell(lx: number, ly: number, lz: number): [number, number, number] {
    // The -90° Y rotation in prepareTemplate negates the Z axis:
    //   scene_x = studsX/2 - lz/20  (decreases with lz → use maxZ - lz)
    //   scene_z = studsZ/2 + lx/20  (increases with lx → use lx - minX)
    const dx = Math.min(studsX - 1, Math.max(0, Math.floor((bbox.maxZ - lz) / LDU_PER_STUD)));
    const dz = Math.min(studsZ - 1, Math.max(0, Math.floor((lx - bbox.minX) / LDU_PER_STUD)));
    const dy = Math.min(heightUnits - 1, Math.max(0, Math.floor((bbox.maxY - ly) / LDU_PER_PLATE)));
    return [dx, dy, dz];
  }

  // 3D DDA line rasterization in cell space
  function rasterizeLine(
    a: [number, number, number],
    b: [number, number, number],
  ): void {
    let [x, y, z] = a;
    const [ex, ey, ez] = b;
    const ddx = Math.abs(ex - x), ddy = Math.abs(ey - y), ddz = Math.abs(ez - z);
    const sx = ex > x ? 1 : ex < x ? -1 : 0;
    const sy = ey > y ? 1 : ey < y ? -1 : 0;
    const sz = ez > z ? 1 : ez < z ? -1 : 0;
    const steps = Math.max(ddx, ddy, ddz);
    // Bresenham-style accumulated error
    let errXY = ddx - ddy, errXZ = ddx - ddz, errYZ = ddy - ddz;
    for (let i = 0; i <= steps; i++) {
      occupiedCells.add(`${x},${y},${z}`);
      if (i === steps) break;
      const exy2 = errXY * 2, exz2 = errXZ * 2, eyz2 = errYZ * 2;
      if (exy2 > -ddy && exz2 > -ddz) { errXY -= ddy; errXZ -= ddz; x += sx; }
      if (exy2 < ddx && eyz2 > -ddz) { errXY += ddx; errYZ -= ddz; y += sy; }
      if (exz2 < ddx && eyz2 < ddy) { errXZ += ddx; errYZ += ddy; z += sz; }
    }
  }

  // Scanline fill of a triangle cross-section at a given dy layer
  function scanlineFillLayer(
    v0: [number, number, number],
    v1: [number, number, number],
    v2: [number, number, number],
    dy: number,
  ): void {
    // Collect all dx,dz pairs from edges that span this dy
    const edgePoints: [number, number][] = [];
    const edges: [[number, number, number], [number, number, number]][] = [
      [v0, v1], [v1, v2], [v2, v0],
    ];
    for (const [a, b] of edges) {
      const minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
      if (dy < minY || dy > maxY) continue;
      // Interpolate dx and dz at this dy
      if (a[1] === b[1]) {
        // Horizontal edge at this layer — include both endpoints
        edgePoints.push([a[0], a[2]], [b[0], b[2]]);
      } else {
        const t = (dy - a[1]) / (b[1] - a[1]);
        const ix = Math.round(a[0] + t * (b[0] - a[0]));
        const iz = Math.round(a[2] + t * (b[2] - a[2]));
        edgePoints.push([ix, iz]);
      }
    }
    if (edgePoints.length < 2) return;

    // Find dx range and scanline fill
    const minDx = Math.min(...edgePoints.map(p => p[0]));
    const maxDx = Math.max(...edgePoints.map(p => p[0]));
    for (let dx = minDx; dx <= maxDx; dx++) {
      // For this dx, find the dz span from edge intersections
      const zVals: number[] = [];
      for (const [a, b] of edges) {
        const minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
        if (dy < minY || dy > maxY) continue;
        if (a[1] === b[1] && a[0] === b[0]) {
          if (a[0] === dx) {
            zVals.push(a[2], b[2]);
          }
        } else {
          // Parametric: find t range where edge passes through this dx at this dy
          // For simplicity, interpolate dz at the edge's crossing of this dy
          const t = a[1] === b[1] ? 0.5 : (dy - a[1]) / (b[1] - a[1]);
          const ix = a[0] + t * (b[0] - a[0]);
          const iz = a[2] + t * (b[2] - a[2]);
          // Check if the interpolated x is close to dx
          if (Math.abs(ix - dx) <= 0.5) {
            zVals.push(Math.round(iz));
          }
        }
      }
      if (zVals.length >= 2) {
        const minZ = Math.min(...zVals), maxZ = Math.max(...zVals);
        for (let dz = minZ; dz <= maxZ; dz++) {
          occupiedCells.add(`${dx},${dy},${dz}`);
        }
      } else if (zVals.length === 1) {
        occupiedCells.add(`${dx},${dy},${zVals[0]}`);
      }
    }
  }

  for (const tri of triangles) {
    const [x0,y0,z0, x1,y1,z1, x2,y2,z2] = tri;
    const c0 = toCell(x0,y0,z0), c1 = toCell(x1,y1,z1), c2 = toCell(x2,y2,z2);

    // Rasterize triangle edges (accurate thin-wall representation)
    rasterizeLine(c0, c1);
    rasterizeLine(c1, c2);
    rasterizeLine(c2, c0);

    // Scanline fill interior at each dy layer the triangle spans
    const minDy = Math.min(c0[1], c1[1], c2[1]);
    const maxDy = Math.max(c0[1], c1[1], c2[1]);
    for (let dy = minDy; dy <= maxDy; dy++) {
      scanlineFillLayer(c0, c1, c2, dy);
    }
  }

  // If the part fills its full AABB, no need for a sparse map
  if (occupiedCells.size >= totalCells) {
    occupancyCache.set(resolved, undefined);
    return undefined;
  }

  const map = [...occupiedCells].map(key => {
    const [dx, dy, dz] = key.split(",").map(Number);
    return { dx, dy, dz };
  });

  occupancyCache.set(resolved, map);
  return map;
}

/**
 * Collect all triangle vertices from an LDraw file, recursively resolving sub-files.
 * Each triangle is stored as a flat array [x0,y0,z0, x1,y1,z1, x2,y2,z2].
 * Quads are split into two triangles.
 */
function collectTriangles(
  filePath: string,
  transform: number[], // [tx,ty,tz, a,b,c, d,e,f, g,h,i]
  ancestors: Set<string>,
): number[][] {
  const resolved = path.resolve(filePath);
  if (ancestors.has(resolved)) return [];
  if (!fsSync.existsSync(resolved)) return [];

  ancestors.add(resolved);
  const content = fsSync.readFileSync(resolved, "utf-8");
  const lines = content.split("\n");
  const tris: number[][] = [];

  const [tx,ty,tz, ta,tb,tc, td,te,tf, tg,th,ti] = transform;

  function xform(x: number, y: number, z: number): [number, number, number] {
    return [
      tx + ta*x + tb*y + tc*z,
      ty + td*x + te*y + tf*z,
      tz + tg*x + th*y + ti*z,
    ];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const lineType = parseInt(parts[0], 10);

    if (lineType === 1 && parts.length >= 15) {
      const sx = parseFloat(parts[2]), sy = parseFloat(parts[3]), sz = parseFloat(parts[4]);
      const sa = parseFloat(parts[5]), sb = parseFloat(parts[6]), sc = parseFloat(parts[7]);
      const sd = parseFloat(parts[8]), se = parseFloat(parts[9]), sf = parseFloat(parts[10]);
      const sg = parseFloat(parts[11]), sh = parseFloat(parts[12]), si = parseFloat(parts[13]);
      const subFile = parts.slice(14).join(" ");
      const subPath = resolveSubFile(resolved, subFile);
      if (!subPath) continue;

      // Compose transforms
      const newTransform = [
        tx + ta*sx + tb*sy + tc*sz,
        ty + td*sx + te*sy + tf*sz,
        tz + tg*sx + th*sy + ti*sz,
        ta*sa + tb*sd + tc*sg, ta*sb + tb*se + tc*sh, ta*sc + tb*sf + tc*si,
        td*sa + te*sd + tf*sg, td*sb + te*se + tf*sh, td*sc + te*sf + tf*si,
        tg*sa + th*sd + ti*sg, tg*sb + th*se + ti*sh, tg*sc + th*sf + ti*si,
      ];
      tris.push(...collectTriangles(subPath, newTransform, ancestors));
    } else if (lineType === 3 && parts.length >= 11) {
      const v0 = xform(parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4]));
      const v1 = xform(parseFloat(parts[5]), parseFloat(parts[6]), parseFloat(parts[7]));
      const v2 = xform(parseFloat(parts[8]), parseFloat(parts[9]), parseFloat(parts[10]));
      tris.push([...v0, ...v1, ...v2]);
    } else if (lineType === 4 && parts.length >= 14) {
      const v0 = xform(parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4]));
      const v1 = xform(parseFloat(parts[5]), parseFloat(parts[6]), parseFloat(parts[7]));
      const v2 = xform(parseFloat(parts[8]), parseFloat(parts[9]), parseFloat(parts[10]));
      const v3 = xform(parseFloat(parts[11]), parseFloat(parts[12]), parseFloat(parts[13]));
      tris.push([...v0, ...v1, ...v2]);
      tris.push([...v0, ...v2, ...v3]);
    }
  }

  ancestors.delete(resolved);
  return tris;
}

function resolveSubFile(parentPath: string, subFile: string): string | null {
  const normalized = subFile.replace(/\\/g, "/");
  const parentDir = path.dirname(parentPath);

  const candidates = [
    path.join(parentDir, normalized),
    path.join(ldrawDir, "parts", normalized),
    path.join(ldrawDir, "p", normalized),
    path.join(ldrawDir, normalized),
  ];

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) return candidate;
  }

  // Try lower-case variant for case-sensitive filesystems
  const lower = normalized.toLowerCase();
  if (lower !== normalized) {
    for (const candidate of [
      path.join(parentDir, lower),
      path.join(ldrawDir, "parts", lower),
      path.join(ldrawDir, "p", lower),
      path.join(ldrawDir, lower),
    ]) {
      if (fsSync.existsSync(candidate)) return candidate;
    }
  }

  return null;
}
