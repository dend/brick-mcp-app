import * as THREE from 'three';
import type { BrickInstance } from '../types';
import { getBrickType } from './BrickCatalog';
import { createBrickMesh, applyBrickTransform, updateBrickColor } from '../three/BrickMesh';

export class SceneReconciler {
  private meshMap = new Map<string, THREE.Object3D>();
  private parent: THREE.Group;

  constructor(parent: THREE.Group) {
    this.parent = parent;
  }

  reconcile(bricks: BrickInstance[]) {
    const incoming = new Set(bricks.map((b) => b.id));

    // Remove deleted bricks
    for (const [id, obj] of this.meshMap) {
      if (!incoming.has(id)) {
        this.parent.remove(obj);
        this.disposeObject(obj);
        this.meshMap.delete(id);
      }
    }

    // Add or update bricks
    for (const brick of bricks) {
      const existing = this.meshMap.get(brick.id);
      if (existing) {
        // Update existing
        const bt = getBrickType(brick.typeId);
        if (bt) {
          applyBrickTransform(existing, brick, bt);
          updateBrickColor(existing, brick.color);
        }
      } else {
        // Add new
        const bt = getBrickType(brick.typeId);
        if (!bt) continue;
        const obj = createBrickMesh(brick, bt);
        this.parent.add(obj);
        this.meshMap.set(brick.id, obj);
      }
    }
  }

  /** Collect all Mesh objects for raycasting (recursive into Groups). */
  getBrickMeshes(): THREE.Object3D[] {
    return Array.from(this.meshMap.values());
  }

  getMeshById(brickId: string): THREE.Object3D | undefined {
    return this.meshMap.get(brickId);
  }

  setHighlight(brickId: string | null) {
    for (const [id, obj] of this.meshMap) {
      const emissiveHex = id === brickId ? 0x333333 : 0x000000;
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(emissiveHex);
      } else {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat.emissive) mat.emissive.setHex(emissiveHex);
          }
        });
      }
    }
  }

  dispose() {
    for (const [, obj] of this.meshMap) {
      this.parent.remove(obj);
      this.disposeObject(obj);
    }
    this.meshMap.clear();
  }

  private disposeObject(obj: THREE.Object3D) {
    // Dispose materials but NOT geometry (shared via template cloning for LDraw)
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        const mat = child.material;
        if (Array.isArray(mat)) {
          mat.forEach(m => m.dispose());
        } else if (mat) {
          mat.dispose();
        }
      }
    });
  }
}
