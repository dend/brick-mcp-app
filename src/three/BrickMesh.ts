import * as THREE from 'three';
import type { BrickInstance, BrickType } from '../types';
import { PLATE_HEIGHT, STUD_SIZE } from '../constants';
import { getBrickGeometry } from './BrickGeometry';

export function createBrickMesh(brick: BrickInstance, brickType: BrickType): THREE.Mesh {
  const geometry = getBrickGeometry(brickType);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(brick.color),
    roughness: 0.6,
    metalness: 0.1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.brickId = brick.id;

  applyBrickTransform(mesh, brick, brickType);
  return mesh;
}

export function applyBrickTransform(mesh: THREE.Object3D, brick: BrickInstance, brickType: BrickType): void {
  const worldX = brick.position.x * STUD_SIZE;
  const worldY = brick.position.y * PLATE_HEIGHT;
  const worldZ = brick.position.z * STUD_SIZE;

  // Reset transform — pivot around brick center for rotation
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);

  // The geometry is built at origin. We rotate around the brick's center.
  const cx = (brickType.studsX * STUD_SIZE) / 2;
  const cz = (brickType.studsZ * STUD_SIZE) / 2;

  const rotRad = -(brick.rotation * Math.PI) / 180;

  // Translate to world position, rotating geometry around its center
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);
  const offsetX = cx - (cx * cos - cz * sin);
  const offsetZ = cz - (cx * sin + cz * cos);

  mesh.rotation.y = rotRad;
  mesh.position.set(worldX + offsetX, worldY, worldZ + offsetZ);
}

export function updateBrickColor(mesh: THREE.Mesh, color: string): void {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.color.set(color);
}
