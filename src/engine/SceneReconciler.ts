import * as THREE from 'three';
import type { BrickInstance } from '../types';
import { getBrickType } from './BrickCatalog';
import { createBrickMesh, applyBrickTransform, updateBrickColor } from '../three/BrickMesh';

export class SceneReconciler {
  private meshMap = new Map<string, THREE.Mesh>();
  private parent: THREE.Group;

  constructor(parent: THREE.Group) {
    this.parent = parent;
  }

  reconcile(bricks: BrickInstance[]) {
    const incoming = new Set(bricks.map((b) => b.id));

    // Remove deleted bricks
    for (const [id, mesh] of this.meshMap) {
      if (!incoming.has(id)) {
        this.parent.remove(mesh);
        (mesh.material as THREE.Material).dispose();
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
        const mesh = createBrickMesh(brick, bt);
        this.parent.add(mesh);
        this.meshMap.set(brick.id, mesh);
      }
    }
  }

  getBrickMeshes(): THREE.Mesh[] {
    return Array.from(this.meshMap.values());
  }

  getMeshById(brickId: string): THREE.Mesh | undefined {
    return this.meshMap.get(brickId);
  }

  setHighlight(brickId: string | null) {
    for (const [id, mesh] of this.meshMap) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissive.setHex(id === brickId ? 0x333333 : 0x000000);
    }
  }

  dispose() {
    for (const [, mesh] of this.meshMap) {
      this.parent.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.meshMap.clear();
  }
}
