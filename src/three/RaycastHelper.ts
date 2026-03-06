import * as THREE from 'three';
import { STUD_SIZE, PLATE_HEIGHT } from '../constants';
import type { BrickType, BrickInstance } from '../types';
import { getBrickType } from '../engine/BrickCatalog';
import { computeOccupiedCells, computeCollisionCells, type BrickLike } from '../engine/OccupancyGrid';

export interface GridHit {
  gridX: number;
  gridY: number;
  gridZ: number;
}

export class RaycastHelper {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  updatePointer(event: PointerEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  raycastBricks(camera: THREE.Camera, meshes: THREE.Object3D[]): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.pointer, camera);
    const hits = this.raycaster.intersectObjects(meshes, true);
    return hits.length > 0 ? hits[0] : null;
  }

  raycastGrid(
    camera: THREE.Camera,
    groundPlane: THREE.Mesh,
    brickMeshes: THREE.Object3D[],
    brickType: BrickType | null,
    rotation: 0 | 90 | 180 | 270,
    bricks?: BrickInstance[],
    excludeId?: string,
  ): GridHit | null {
    this.raycaster.setFromCamera(this.pointer, camera);

    let gridX: number;
    let gridY: number;
    let gridZ: number;

    // Check if we hit an existing brick
    const brickHits = this.raycaster.intersectObjects(brickMeshes, true);
    if (brickHits.length > 0) {
      const hit = brickHits[0];
      const brickId = hit.object.userData.brickId as string;
      const hitBrick = bricks?.find(b => b.id === brickId);
      if (hitBrick) {
        // Detect side-face hits: skip stacking when ray hits the side of a brick
        const worldNormal = hit.face?.normal?.clone();
        if (worldNormal) worldNormal.transformDirection(hit.object.matrixWorld);
        const isSideHit = worldNormal && Math.abs(worldNormal.y) < 0.5;

        const bt = getBrickType(hitBrick.typeId);
        if (bt && !isSideHit) {
          gridX = Math.floor(hit.point.x / STUD_SIZE);
          gridZ = Math.floor(hit.point.z / STUD_SIZE);

          if (bt.occupancyMap) {
            // For non-rectangular parts, find the height of the specific column that was hit
            const cells = computeOccupiedCells(hitBrick as BrickLike, bt);

            // Find cells matching the hit column
            let matchingCells = cells.filter(c => c.x === gridX && c.z === gridZ);

            // Mesh boundary fix: if hit point falls just outside the brick's
            // occupied cells (floating-point edge), snap to the nearest column
            if (matchingCells.length === 0) {
              let bestDist = Infinity;
              let bestX = gridX, bestZ = gridZ;
              const seen = new Set<string>();
              for (const c of cells) {
                const key = `${c.x},${c.z}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const dist = Math.abs(c.x - gridX) + Math.abs(c.z - gridZ);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestX = c.x;
                  bestZ = c.z;
                }
              }
              gridX = bestX;
              gridZ = bestZ;
              matchingCells = cells.filter(c => c.x === gridX && c.z === gridZ);
            }

            let colTop = hitBrick.position.y; // fallback: brick base
            for (const c of matchingCells) {
              if (c.y + 1 > colTop) {
                colTop = c.y + 1;
              }
            }
            gridY = colTop;
          } else {
            gridY = hitBrick.position.y + bt.heightUnits;
          }
        } else {
          gridX = Math.floor(hit.point.x / STUD_SIZE);
          gridY = Math.round(hit.point.y / PLATE_HEIGHT);
          gridZ = Math.floor(hit.point.z / STUD_SIZE);
        }
      } else {
        gridX = Math.floor(hit.point.x / STUD_SIZE);
        gridY = Math.round(hit.point.y / PLATE_HEIGHT);
        gridZ = Math.floor(hit.point.z / STUD_SIZE);
      }
    } else {
      // Otherwise hit the ground plane
      const groundHits = this.raycaster.intersectObject(groundPlane, false);
      if (groundHits.length > 0) {
        const point = groundHits[0].point;
        gridX = Math.floor(point.x / STUD_SIZE);
        gridY = 0;
        gridZ = Math.floor(point.z / STUD_SIZE);
      } else {
        return null;
      }
    }

    // Auto-elevate: scan upward to find lowest collision-free Y position.
    // Uses collision cells (excludes thin plate surfaces from non-rectangular
    // parts so brackets can nest over bricks when placed beside them).
    if (brickType && bricks) {
      const occupied = new Set<string>();
      for (const existing of bricks) {
        if (excludeId && existing.id === excludeId) continue;
        const et = getBrickType(existing.typeId);
        if (!et) continue;
        for (const c of computeOccupiedCells(existing as BrickLike, et)) {
          occupied.add(`${c.x},${c.y},${c.z}`);
        }
      }

      const maxScan = 100;
      for (let attempt = 0; attempt < maxScan; attempt++) {
        const candidate: BrickLike = {
          id: '__raycast__', typeId: '', position: { x: gridX, y: gridY, z: gridZ }, rotation,
        };
        // Non-rectangular parts (occupancyMap): skip auto-elevation entirely,
        // server validates placement. This avoids voxelization artifacts causing
        // false collisions with adjacent bricks.
        const cells = brickType.occupancyMap
          ? []
          : computeCollisionCells(candidate, brickType);
        const collides = cells.some(c => occupied.has(`${c.x},${c.y},${c.z}`));
        if (!collides) break;
        gridY++;
      }
    }

    return { gridX, gridY, gridZ };
  }
}
