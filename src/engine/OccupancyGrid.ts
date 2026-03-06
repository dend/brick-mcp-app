/**
 * Sparse 3D occupancy grid for precise collision detection.
 * Each cell is 1 stud × 1 plate × 1 stud, matching the coordinate system.
 */

export interface GridCell {
  x: number;
  y: number;
  z: number;
}

export interface BrickLike {
  id: string;
  typeId: string;
  position: { x: number; y: number; z: number };
  rotation: 0 | 90 | 180 | 270;
}

export interface BrickDimensions {
  studsX: number;
  studsZ: number;
  heightUnits: number;
  occupancyMap?: { dx: number; dy: number; dz: number }[];
}

export class OccupancyGrid {
  private cells = new Map<string, string>(); // "x,y,z" -> brickId

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  /** Check if any cells in the list are occupied (optionally excluding a brick) */
  canPlace(cells: GridCell[], excludeId?: string): boolean {
    for (const c of cells) {
      const occupant = this.cells.get(this.key(c.x, c.y, c.z));
      if (occupant && occupant !== excludeId) return false;
    }
    return true;
  }

  /** Mark cells as occupied by a brick */
  place(brickId: string, cells: GridCell[]): void {
    for (const c of cells) {
      this.cells.set(this.key(c.x, c.y, c.z), brickId);
    }
  }

  /** Remove all cells for a brick */
  remove(brickId: string): void {
    for (const [key, id] of this.cells) {
      if (id === brickId) this.cells.delete(key);
    }
  }

  /** Check if the brick at given position has support (cell below bottom layer is occupied or on ground) */
  hasSupport(brick: BrickLike, dims: BrickDimensions): boolean {
    const bottomY = brick.position.y;
    if (bottomY === 0) return true; // On baseplate

    const bottomCells = computeBottomCells(brick, dims);
    return bottomCells.some(c => {
      const below = this.cells.get(this.key(c.x, c.y - 1, c.z));
      return below != null;
    });
  }

  /** Get the occupant brick ID at a specific cell, or null */
  getOccupantAt(x: number, y: number, z: number): string | null {
    return this.cells.get(this.key(x, y, z)) ?? null;
  }

  /** Rebuild from a set of bricks */
  rebuild(bricks: BrickLike[], getType: (id: string) => BrickDimensions | undefined): void {
    this.cells.clear();
    for (const brick of bricks) {
      const type = getType(brick.typeId);
      if (!type) continue;
      const cells = computeOccupiedCells(brick, type);
      this.place(brick.id, cells);
    }
  }

  /** Clear all cells */
  clear(): void {
    this.cells.clear();
  }
}

/**
 * Compute all occupied cells for a brick.
 * Uses the sparse occupancy map if available (non-rectangular parts like brackets),
 * otherwise fills the full rectangular AABB.
 */
export function computeOccupiedCells(brick: BrickLike, type: BrickDimensions): GridCell[] {
  const { x, y, z } = brick.position;

  if (type.occupancyMap) {
    return type.occupancyMap.map(cell => {
      const rotated = rotateCell(cell.dx, cell.dz, type.studsX, type.studsZ, brick.rotation);
      return { x: x + rotated.dx, y: y + cell.dy, z: z + rotated.dz };
    });
  }

  // Full AABB fallback for standard rectangular parts
  const cells: GridCell[] = [];
  const isRotated = brick.rotation === 90 || brick.rotation === 270;
  const sx = isRotated ? type.studsZ : type.studsX;
  const sz = isRotated ? type.studsX : type.studsZ;

  for (let dx = 0; dx < sx; dx++) {
    for (let dy = 0; dy < type.heightUnits; dy++) {
      for (let dz = 0; dz < sz; dz++) {
        cells.push({ x: x + dx, y: y + dy, z: z + dz });
      }
    }
  }

  return cells;
}

/**
 * Compute collision cells for a brick — excludes "plate-surface" columns.
 * In non-rectangular parts (brackets), columns that are only 1 plate tall
 * (thin plate surfaces) don't block placement. This allows nesting: e.g.
 * placing a bracket over an existing brick so the gap surrounds it.
 * For standard rectangular parts, this is identical to computeOccupiedCells.
 */
export function computeCollisionCells(brick: BrickLike, type: BrickDimensions): GridCell[] {
  if (!type.occupancyMap) return computeOccupiedCells(brick, type);

  // Find per-column max height
  const colHeights = new Map<string, number>();
  for (const cell of type.occupancyMap) {
    const key = `${cell.dx},${cell.dz}`;
    colHeights.set(key, Math.max(colHeights.get(key) ?? 0, cell.dy + 1));
  }

  // Exclude non-structural columns using neighbor-connectivity:
  // A column is structural only if height > 1 AND it has at least one
  // tall (h>1) neighbor on EACH horizontal axis (dx AND dz).
  // This correctly filters thin walls (bracket wall has no tall dx-neighbor)
  // while keeping solid 2x2+ regions (tall neighbors on both axes).
  function isTall(dx: number, dz: number): boolean {
    return (colHeights.get(`${dx},${dz}`) ?? 0) > 1;
  }

  const structuralCols = new Set<string>();
  for (const [key, h] of colHeights) {
    if (h <= 1) continue;
    const [dx, dz] = key.split(',').map(Number);
    const hasTallDxNeighbor = isTall(dx - 1, dz) || isTall(dx + 1, dz);
    const hasTallDzNeighbor = isTall(dx, dz - 1) || isTall(dx, dz + 1);
    if (hasTallDxNeighbor && hasTallDzNeighbor) structuralCols.add(key);
  }

  const { x, y, z } = brick.position;
  return type.occupancyMap
    .filter(cell => structuralCols.has(`${cell.dx},${cell.dz}`))
    .map(cell => {
      const rotated = rotateCell(cell.dx, cell.dz, type.studsX, type.studsZ, brick.rotation);
      return { x: x + rotated.dx, y: y + cell.dy, z: z + rotated.dz };
    });
}

/**
 * Rotate a cell offset (dx, dz) according to the brick rotation.
 * dx is along studsX, dz is along studsZ (before rotation).
 */
function rotateCell(
  dx: number,
  dz: number,
  studsX: number,
  studsZ: number,
  rotation: 0 | 90 | 180 | 270,
): { dx: number; dz: number } {
  switch (rotation) {
    case 0:
      return { dx, dz };
    case 90:
      // 90° CW: (dx, dz) → (studsZ - 1 - dz, dx)
      return { dx: studsZ - 1 - dz, dz: dx };
    case 180:
      // 180°: (dx, dz) → (studsX - 1 - dx, studsZ - 1 - dz)
      return { dx: studsX - 1 - dx, dz: studsZ - 1 - dz };
    case 270:
      // 270° CW: (dx, dz) → (dz, studsX - 1 - dx)
      return { dx: dz, dz: studsX - 1 - dx };
    default:
      return { dx, dz };
  }
}

/**
 * Compute just the bottom-layer cells (for support checking).
 */
function computeBottomCells(brick: BrickLike, type: BrickDimensions): GridCell[] {
  if (type.occupancyMap) {
    // Filter to cells at dy=0 (bottom layer of the part)
    const { x, y, z } = brick.position;
    return type.occupancyMap
      .filter(cell => cell.dy === 0)
      .map(cell => {
        const rotated = rotateCell(cell.dx, cell.dz, type.studsX, type.studsZ, brick.rotation);
        return { x: x + rotated.dx, y, z: z + rotated.dz };
      });
  }

  const cells: GridCell[] = [];
  const { x, y, z } = brick.position;
  const isRotated = brick.rotation === 90 || brick.rotation === 270;
  const sx = isRotated ? type.studsZ : type.studsX;
  const sz = isRotated ? type.studsX : type.studsZ;

  for (let dx = 0; dx < sx; dx++) {
    for (let dz = 0; dz < sz; dz++) {
      cells.push({ x: x + dx, y, z: z + dz });
    }
  }

  return cells;
}
