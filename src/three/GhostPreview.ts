import * as THREE from 'three';
import type { BrickType } from '../types';
import { PLATE_HEIGHT, STUD_SIZE } from '../constants';
import { getBrickGeometry } from './BrickGeometry';
import { ldrawPartLoader } from '../ldraw/LDrawPartLoader';

export class GhostPreview {
  preview: THREE.Object3D | null = null;
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
    if (!this.preview || this.currentTypeId !== brickType.id) {
      this.hide();
      this.preview = this.createGhost(brickType, isValid);
      this.scene.add(this.preview);
      this.currentTypeId = brickType.id;
    }

    // Update validity color
    const ghostColor = isValid ? 0x00ff00 : 0xff0000;
    this.preview.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.color.setHex(ghostColor);
      }
    });

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

    this.preview.position.set(
      gridX * STUD_SIZE + offsetX,
      gridY * PLATE_HEIGHT,
      gridZ * STUD_SIZE + offsetZ,
    );
    this.preview.rotation.y = rotRad;
    this.preview.visible = true;
  }

  private createGhost(brickType: BrickType, isValid: boolean): THREE.Object3D {
    const ghostColor = isValid ? 0x00ff00 : 0xff0000;

    // Try LDraw template first
    if (ldrawPartLoader.isReady() && ldrawPartLoader.getTemplate(brickType.id)) {
      const template = ldrawPartLoader.getTemplate(brickType.id)!;
      const clone = template.clone();

      // Apply origin shift like LDrawPartLoader.createColoredClone does
      clone.position.set(brickType.studsX * 0.5, 0, brickType.studsZ * 0.5);

      // Apply ghost material to all meshes
      clone.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: ghostColor,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
        } else if (child instanceof THREE.LineSegments) {
          child.material = new THREE.LineBasicMaterial({
            color: ghostColor,
            transparent: true,
            opacity: 0.4,
          });
        }
      });

      const wrapper = new THREE.Group();
      wrapper.add(clone);
      wrapper.renderOrder = 999;
      return wrapper;
    }

    // Procedural fallback
    const geometry = getBrickGeometry(brickType);
    const material = new THREE.MeshStandardMaterial({
      color: ghostColor,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 999;
    return mesh;
  }

  hide() {
    if (this.preview) {
      this.scene.remove(this.preview);
      // Dispose materials
      this.preview.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          const mat = child.material;
          if (Array.isArray(mat)) {
            mat.forEach(m => m.dispose());
          } else if (mat) {
            mat.dispose();
          }
        }
      });
      // Don't dispose geometry if it came from procedural cache
      this.preview = null;
      this.currentTypeId = null;
    }
  }

  dispose() {
    this.hide();
  }
}
