import * as THREE from 'three';
import { STUD_SIZE, PLATE_HEIGHT } from '../constants';
import type { BrickType } from '../types';

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
    _brickType: BrickType | null,
  ): GridHit | null {
    this.raycaster.setFromCamera(this.pointer, camera);

    // First check if we hit an existing brick (for stacking)
    const brickHits = this.raycaster.intersectObjects(brickMeshes, false);
    if (brickHits.length > 0) {
      const hit = brickHits[0];
      const normal = hit.face!.normal.clone();
      normal.applyQuaternion(hit.object.quaternion);

      // Place on top of hit brick
      const point = hit.point.clone().add(normal.multiplyScalar(0.01));
      return {
        gridX: Math.floor(point.x / STUD_SIZE),
        gridY: Math.round(point.y / PLATE_HEIGHT),
        gridZ: Math.floor(point.z / STUD_SIZE),
      };
    }

    // Otherwise hit the ground plane
    const groundHits = this.raycaster.intersectObject(groundPlane, false);
    if (groundHits.length > 0) {
      const point = groundHits[0].point;
      return {
        gridX: Math.floor(point.x / STUD_SIZE),
        gridY: 0,
        gridZ: Math.floor(point.z / STUD_SIZE),
      };
    }

    return null;
  }
}
