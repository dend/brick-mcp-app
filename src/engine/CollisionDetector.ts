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

// Block-out zone above the slope face — prevents placing bricks that would float
// above the sloped portion where there is no flat surface.
function getSlopeBlockoutAABB(brick: BrickInstance, brickType: BrickType): AABB | null {
  if (brickType.category !== 'slope') return null;
  const { x, y, z } = brick.position;
  const isRotated = brick.rotation === 90 || brick.rotation === 270;
  const sx = isRotated ? brickType.studsZ : brickType.studsX;
  const sz = isRotated ? brickType.studsX : brickType.studsZ;
  const slopeDepth = Math.ceil(brickType.studsZ / 2);
  const topY = y + brickType.heightUnits;
  const blockoutMaxY = topY + brickType.heightUnits;

  switch (brick.rotation) {
    case 0:   // slope faces -Z → front at small Z
      return { minX: x, maxX: x + sx, minY: topY, maxY: blockoutMaxY, minZ: z, maxZ: z + slopeDepth };
    case 90:  // slope faces +X → front at large X
      return { minX: x + sx - slopeDepth, maxX: x + sx, minY: topY, maxY: blockoutMaxY, minZ: z, maxZ: z + sz };
    case 180: // slope faces +Z → front at large Z
      return { minX: x, maxX: x + sx, minY: topY, maxY: blockoutMaxY, minZ: z + sz - slopeDepth, maxZ: z + sz };
    case 270: // slope faces -X → front at small X
      return { minX: x, maxX: x + slopeDepth, minY: topY, maxY: blockoutMaxY, minZ: z, maxZ: z + sz };
    default:
      return null;
  }
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
  const candidateBlockout = getSlopeBlockoutAABB(candidate, brickType);

  for (const existing of bricks) {
    if (excludeId && existing.id === excludeId) continue;
    const existType = getBrickType(existing.typeId);
    if (!existType) continue;
    const existAABB = getBrickAABB(existing, existType);
    if (aabbOverlap(candidateAABB, existAABB)) {
      return true;
    }
    // Candidate sits in an existing slope's block-out zone
    const existBlockout = getSlopeBlockoutAABB(existing, existType);
    if (existBlockout && aabbOverlap(candidateAABB, existBlockout)) {
      return true;
    }
    // Candidate slope's block-out zone covers an existing brick
    if (candidateBlockout && aabbOverlap(candidateBlockout, existAABB)) {
      return true;
    }
  }
  return false;
}
