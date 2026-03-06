import type { BrickInstance, BrickType, AABB } from '../types';
import { getBrickType } from './BrickCatalog';
import { computeOccupiedCells, type BrickLike } from './OccupancyGrid';

export function getBrickAABB(brick: BrickInstance, brickType: BrickType): AABB {
  const { x, y, z } = brick.position;
  const isRotated = brick.rotation === 90 || brick.rotation === 270;
  const sx = isRotated ? brickType.studsZ : brickType.studsX;
  const sz = isRotated ? brickType.studsX : brickType.studsZ;
  return {
    minX: x, maxX: x + sx,
    minY: y, maxY: y + brickType.heightUnits,
    minZ: z, maxZ: z + sz,
  };
}

export function checkSupportClient(
  bricks: BrickInstance[],
  typeId: string,
  x: number,
  y: number,
  z: number,
  rotation: 0 | 90 | 180 | 270,
  excludeId?: string,
): boolean {
  const brickType = getBrickType(typeId);
  if (!brickType) return false;
  if (y === 0) return true;

  const candidate: BrickLike = { id: '__check__', typeId, position: { x, y, z }, rotation };
  const candidateCells = computeOccupiedCells(candidate, brickType);

  // Find bottom-layer cells (minimum dy for this brick)
  const bottomCells = candidateCells.filter(c => c.y === y);

  // Build a set of all occupied cells from existing bricks
  const occupiedSet = new Set<string>();
  for (const existing of bricks) {
    if (excludeId && existing.id === excludeId) continue;
    const et = getBrickType(existing.typeId);
    if (!et) continue;
    const cells = computeOccupiedCells(existing, et);
    for (const c of cells) occupiedSet.add(`${c.x},${c.y},${c.z}`);
  }

  // Check if any cell directly below the bottom layer is occupied
  return bottomCells.some(c => occupiedSet.has(`${c.x},${c.y - 1},${c.z}`));
}

export function checkCollisionClient(
  bricks: BrickInstance[],
  typeId: string,
  x: number,
  y: number,
  z: number,
  rotation: 0 | 90 | 180 | 270,
  excludeId?: string,
): boolean {
  const brickType = getBrickType(typeId);
  if (!brickType) return true;

  const candidate: BrickLike = { id: '__ghost__', typeId, position: { x, y, z }, rotation };
  const candidateCells = computeOccupiedCells(candidate, brickType);

  // Build a set of all occupied cells from existing bricks
  const occupiedSet = new Set<string>();
  for (const existing of bricks) {
    if (excludeId && existing.id === excludeId) continue;
    const existType = getBrickType(existing.typeId);
    if (!existType) continue;
    const cells = computeOccupiedCells(existing, existType);
    for (const c of cells) occupiedSet.add(`${c.x},${c.y},${c.z}`);
  }

  return candidateCells.some(c => occupiedSet.has(`${c.x},${c.y},${c.z}`));
}
