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

  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);

  const w = brickType.studsX * STUD_SIZE;
  const d = brickType.studsZ * STUD_SIZE;
  const rotRad = -(brick.rotation * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);

  // Geometry is corner-origin [0,w]×[0,d]. After rotation, find the min corner
  // of the rotated bounding box and offset so it aligns with (worldX, worldZ).
  const rx1 = w * cos;
  const rx2 = d * sin;
  const offsetX = -Math.min(0, rx1, rx2, rx1 + rx2);
  const rz1 = -w * sin;
  const rz2 = d * cos;
  const offsetZ = -Math.min(0, rz1, rz2, rz1 + rz2);

  mesh.rotation.y = rotRad;
  mesh.position.set(worldX + offsetX, worldY, worldZ + offsetZ);
}

export function updateBrickColor(mesh: THREE.Mesh, color: string): void {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.color.set(color);
}
