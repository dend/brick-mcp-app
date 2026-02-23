import * as THREE from 'three';
import type { BrickType } from '../types';
import { PLATE_HEIGHT, STUD_SIZE } from '../constants';
import { getBrickGeometry } from './BrickGeometry';

export class GhostPreview {
  mesh: THREE.Mesh | null = null;
  private scene: THREE.Scene;
  private currentTypeId: string | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  show(
    brickType: BrickType,
    gridX: number,
    gridY: number,
    gridZ: number,
    rotation: 0 | 90 | 180 | 270,
    isValid: boolean,
  ) {
    if (!this.mesh || this.currentTypeId !== brickType.id) {
      this.hide();
      const geometry = getBrickGeometry(brickType);
      const material = new THREE.MeshStandardMaterial({
        color: isValid ? 0x00ff00 : 0xff0000,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      });
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.renderOrder = 999;
      this.scene.add(this.mesh);
      this.currentTypeId = brickType.id;
    }

    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(isValid ? 0x00ff00 : 0xff0000);

    const w = brickType.studsX * STUD_SIZE;
    const d = brickType.studsZ * STUD_SIZE;
    const rotRad = -(rotation * Math.PI) / 180;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);

    const rx1 = w * cos;
    const rx2 = d * sin;
    const offsetX = -Math.min(0, rx1, rx2, rx1 + rx2);
    const rz1 = -w * sin;
    const rz2 = d * cos;
    const offsetZ = -Math.min(0, rz1, rz2, rz1 + rz2);

    this.mesh.position.set(
      gridX * STUD_SIZE + offsetX,
      gridY * PLATE_HEIGHT,
      gridZ * STUD_SIZE + offsetZ,
    );
    this.mesh.rotation.y = rotRad;
    this.mesh.visible = true;
  }

  hide() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry = undefined!; // don't dispose cached geometry
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
      this.currentTypeId = null;
    }
  }

  dispose() {
    this.hide();
  }
}
