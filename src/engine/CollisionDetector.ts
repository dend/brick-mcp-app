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

// Return the physical footprint AABBs for a brick (L-shape arms for corners, full AABB otherwise).
function getPhysicalFootprint(brick: BrickInstance, brickType: BrickType): AABB[] {
  const aabb = getBrickAABB(brick, brickType);
  if (brickType.category !== 'corner') return [aabb];

  const { x, z } = brick.position;
  const n = brickType.studsX;
  const rot = brick.rotation;
  const rowAtZMax = rot === 90 || rot === 180;
  const colAtXMax = rot === 180 || rot === 270;

  const rowArm: AABB = {
    minX: x, maxX: x + n,
    minY: aabb.minY, maxY: aabb.maxY,
    minZ: rowAtZMax ? z + n - 1 : z,
    maxZ: rowAtZMax ? z + n : z + 1,
  };
  const colArm: AABB = {
    minX: colAtXMax ? x + n - 1 : x,
    maxX: colAtXMax ? x + n : x + 1,
    minY: aabb.minY, maxY: aabb.maxY,
    minZ: rowAtZMax ? z : z + 1,
    maxZ: rowAtZMax ? z + n - 1 : z + n,
  };
  return [rowArm, colArm];
}

function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX &&
    a.minY < b.maxY && a.maxY > b.minY &&
    a.minZ < b.maxZ && a.maxZ > b.minZ
  );
}

// Compute world-space block-out AABBs from a brick's definition, applying rotation.
function getBlockoutAABBs(brick: BrickInstance, brickType: BrickType): AABB[] {
  if (!brickType.blockout?.length) return [];
  const { x, y, z } = brick.position;
  const cx = brickType.studsX / 2;
  const cz = brickType.studsZ / 2;
  const topY = y + brickType.heightUnits;
  const rotRad = -(brick.rotation * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);

  return brickType.blockout.map(bo => {
    // Rotate the 4 corners of the blockout footprint around the brick center
    const corners: [number, number][] = [
      [bo.minX - cx, bo.minZ - cz],
      [bo.maxX - cx, bo.minZ - cz],
      [bo.minX - cx, bo.maxZ - cz],
      [bo.maxX - cx, bo.maxZ - cz],
    ];
    let rMinX = Infinity, rMaxX = -Infinity;
    let rMinZ = Infinity, rMaxZ = -Infinity;
    for (const [dx, dz] of corners) {
      const rx = dx * cos - dz * sin + cx;
      const rz = dx * sin + dz * cos + cz;
      rMinX = Math.min(rMinX, rx);
      rMaxX = Math.max(rMaxX, rx);
      rMinZ = Math.min(rMinZ, rz);
      rMaxZ = Math.max(rMaxZ, rz);
    }
    return {
      minX: x + Math.round(rMinX),
      maxX: x + Math.round(rMaxX),
      minY: topY,
      maxY: topY + bo.height,
      minZ: z + Math.round(rMinZ),
      maxZ: z + Math.round(rMaxZ),
    };
  });
}

// Does `topAABB` have stud support from the brick below (`bottomAABB`)?
// Returns true if the top brick sits directly on the bottom brick's studs
// (the part of the bottom brick's top face NOT covered by blockout zones).
function hasStudSupport(
  topAABB: AABB,
  bottomAABB: AABB,
  bottomBlockouts: AABB[],
): boolean {
  // Top brick must sit exactly on the bottom brick's top
  if (topAABB.minY !== bottomAABB.maxY) return false;

  // Compute XZ intersection of top brick and bottom brick footprint
  const interMinX = Math.max(topAABB.minX, bottomAABB.minX);
  const interMaxX = Math.min(topAABB.maxX, bottomAABB.maxX);
  const interMinZ = Math.max(topAABB.minZ, bottomAABB.minZ);
  const interMaxZ = Math.min(topAABB.maxZ, bottomAABB.maxZ);
  if (interMinX >= interMaxX || interMinZ >= interMaxZ) return false;

  // Check if the XZ intersection is entirely within any single blockout zone.
  // If so, there are no studs in the overlap → no support.
  for (const bo of bottomBlockouts) {
    if (interMinX >= bo.minX && interMaxX <= bo.maxX &&
        interMinZ >= bo.minZ && interMaxZ <= bo.maxZ) {
      return false;
    }
  }
  // Intersection extends beyond blockout zones → studs exist → supported
  return true;
}

// Check if a brick has physical support — on baseplate (Y=0) or resting on another brick.
// Uses L-shape footprint for corner pieces instead of full AABB.
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
  if (aabb.minY === 0) return true; // On baseplate

  const newFootprint = getPhysicalFootprint(candidate, brickType);
  for (const existing of bricks) {
    const et = getBrickType(existing.typeId);
    if (!et) continue;
    const ea = getBrickAABB(existing, et);
    if (ea.maxY !== aabb.minY) continue;
    const existFootprint = getPhysicalFootprint(existing, et);
    for (const nf of newFootprint) {
      for (const ef of existFootprint) {
        if (nf.minX < ef.maxX && nf.maxX > ef.minX &&
            nf.minZ < ef.maxZ && nf.maxZ > ef.minZ) {
          return true;
        }
      }
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
  const candidateBlockouts = getBlockoutAABBs(candidate, brickType);

  const candidateFootprint = getPhysicalFootprint(candidate, brickType);

  for (const existing of bricks) {
    if (excludeId && existing.id === excludeId) continue;
    const existType = getBrickType(existing.typeId);
    if (!existType) continue;
    const existAABB = getBrickAABB(existing, existType);
    // Use physical footprint overlap (L-shape aware) instead of AABB
    const existFootprint = getPhysicalFootprint(existing, existType);
    let hasPhysicalOverlap = false;
    for (const cf of candidateFootprint) {
      for (const ef of existFootprint) {
        if (aabbOverlap(cf, ef)) { hasPhysicalOverlap = true; break; }
      }
      if (hasPhysicalOverlap) break;
    }
    if (hasPhysicalOverlap) {
      return true;
    }
    // Candidate sits in an existing brick's block-out zone
    const existBlockouts = getBlockoutAABBs(existing, existType);
    for (const bo of existBlockouts) {
      if (aabbOverlap(candidateAABB, bo)) {
        // Allow if candidate also connects to studs on the same brick
        if (!hasStudSupport(candidateAABB, existAABB, existBlockouts)) return true;
      }
    }
    // Candidate brick's block-out zone covers an existing brick
    for (const bo of candidateBlockouts) {
      if (aabbOverlap(bo, existAABB)) {
        // Allow if existing brick connects to studs on the candidate
        if (!hasStudSupport(existAABB, candidateAABB, candidateBlockouts)) return true;
      }
    }
  }
  return false;
}
