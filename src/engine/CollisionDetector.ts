import type { BrickInstance, BrickType, AABB } from '../types';
import { getBrickType } from './BrickCatalog';

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

function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX &&
    a.minY < b.maxY && a.maxY > b.minY &&
    a.minZ < b.maxZ && a.maxZ > b.minZ
  );
}

export function checkSupportClient(
  bricks: BrickInstance[],
  typeId: string,
  x: number,
  y: number,
  z: number,
  rotation: 0 | 90 | 180 | 270,
): boolean {
  const brickType = getBrickType(typeId);
  if (!brickType) return false;
  const candidate: BrickInstance = {
    id: '__check__',
    typeId,
    position: { x, y, z },
    rotation,
    color: '#000000',
  };
  const aabb = getBrickAABB(candidate, brickType);
  if (aabb.minY === 0) return true;

  for (const existing of bricks) {
    const et = getBrickType(existing.typeId);
    if (!et) continue;
    const ea = getBrickAABB(existing, et);
    if (ea.maxY !== aabb.minY) continue;
    // XZ overlap check
    if (aabb.minX < ea.maxX && aabb.maxX > ea.minX &&
        aabb.minZ < ea.maxZ && aabb.maxZ > ea.minZ) {
      return true;
    }
  }
  return false;
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

  const candidate: BrickInstance = {
    id: '__ghost__',
    typeId,
    position: { x, y, z },
    rotation,
    color: '#000000',
  };
  const candidateAABB = getBrickAABB(candidate, brickType);

  for (const existing of bricks) {
    if (excludeId && existing.id === excludeId) continue;
    const existType = getBrickType(existing.typeId);
    if (!existType) continue;
    const existAABB = getBrickAABB(existing, existType);
    if (aabbOverlap(candidateAABB, existAABB)) {
      return true;
    }
  }
  return false;
}
