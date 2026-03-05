import * as THREE from 'three';
import { STUD_SIZE, PLATE_HEIGHT } from '../constants';
import type { BrickType, BrickInstance } from '../types';
import { getBrickType } from '../engine/BrickCatalog';
import { computeOccupiedCells, type BrickLike } from '../engine/OccupancyGrid';

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
        const bt = getBrickType(hitBrick.typeId);
        if (bt) {
          gridX = Math.floor(hit.point.x / STUD_SIZE);
          gridY = hitBrick.position.y + bt.heightUnits;
          gridZ = Math.floor(hit.point.z / STUD_SIZE);
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
    // This correctly handles non-rectangular parts (L-shapes, brackets, etc.)
    // by checking actual cell overlap instead of AABB projections.
    if (brickType && bricks) {
      // Build occupied cell set from all existing bricks
      const occupied = new Set<string>();
      for (const existing of bricks) {
        if (excludeId && existing.id === excludeId) continue;
        const et = getBrickType(existing.typeId);
        if (!et) continue;
        for (const c of computeOccupiedCells(existing, et)) {
          occupied.add(`${c.x},${c.y},${c.z}`);
        }
      }

      // Scan upward from current gridY until no collision
      const maxScan = 100; // safety limit
      for (let attempt = 0; attempt < maxScan; attempt++) {
        const candidate: BrickLike = {
          id: '__raycast__', typeId: '', position: { x: gridX, y: gridY, z: gridZ }, rotation,
        };
        const cells = computeOccupiedCells(candidate, brickType);
        const collides = cells.some(c => occupied.has(`${c.x},${c.y},${c.z}`));
        if (!collides) break;
        gridY++;
      }
    }

    return { gridX, gridY, gridZ };
  }
}
