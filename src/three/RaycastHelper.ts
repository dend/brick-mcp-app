import * as THREE from 'three';
import { STUD_SIZE, PLATE_HEIGHT } from '../constants';
import type { BrickType, BrickInstance } from '../types';
import { getBrickType } from '../engine/BrickCatalog';

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
    const hits = this.raycaster.intersectObjects(meshes, false);
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
    const brickHits = this.raycaster.intersectObjects(brickMeshes, false);
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

    // Auto-elevate: if the new brick's footprint overlaps any existing brick,
    // place on top of the highest overlapping brick
    if (brickType && bricks) {
      const isRotated = rotation === 90 || rotation === 270;
      const sx = isRotated ? brickType.studsZ : brickType.studsX;
      const sz = isRotated ? brickType.studsX : brickType.studsZ;
      for (const existing of bricks) {
        if (excludeId && existing.id === excludeId) continue;
        const et = getBrickType(existing.typeId);
        if (!et) continue;
        const eRot = existing.rotation === 90 || existing.rotation === 270;
        const esx = eRot ? et.studsZ : et.studsX;
        const esz = eRot ? et.studsX : et.studsZ;
        if (gridX < existing.position.x + esx && gridX + sx > existing.position.x &&
            gridZ < existing.position.z + esz && gridZ + sz > existing.position.z) {
          const topY = existing.position.y + et.heightUnits;
          if (topY > gridY) gridY = topY;
        }
      }
    }

    return { gridX, gridY, gridZ };
  }
}
