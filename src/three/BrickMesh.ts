import * as THREE from 'three';
import type { BrickInstance, BrickType } from '../types';
import { PLATE_HEIGHT, STUD_SIZE } from '../constants';
import { getBrickGeometry } from './BrickGeometry';
import { ldrawPartLoader } from '../ldraw/LDrawPartLoader';

export function createBrickMesh(brick: BrickInstance, brickType: BrickType): THREE.Object3D {
  // Try LDraw geometry first
  if (ldrawPartLoader.isReady() && ldrawPartLoader.getTemplate(brickType.id)) {
    return createLDrawMesh(brick, brickType);
  }
  // Fall back to procedural geometry
  return createProceduralMesh(brick, brickType);
}

function createLDrawMesh(brick: BrickInstance, brickType: BrickType): THREE.Object3D {
  const obj = ldrawPartLoader.createColoredClone(brickType.id, brickType, brick.color);
  if (!obj) {
    return createProceduralMesh(brick, brickType);
  }

  // Set brickId on all child meshes for raycasting
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.userData.brickId = brick.id;
    }
  });

  // Wrap in a group for transform consistency
  const wrapper = new THREE.Group();
  wrapper.add(obj);
  wrapper.userData.brickId = brick.id;
  wrapper.userData.procedural = false;

  applyBrickTransform(wrapper, brick, brickType);
  return wrapper;
}

function createProceduralMesh(brick: BrickInstance, brickType: BrickType): THREE.Object3D {
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
  mesh.userData.procedural = true;

  applyBrickTransform(mesh, brick, brickType);
  return mesh;
}

export function applyBrickTransform(obj: THREE.Object3D, brick: BrickInstance, brickType: BrickType): void {
  const worldX = brick.position.x * STUD_SIZE;
  const worldY = brick.position.y * PLATE_HEIGHT;
  const worldZ = brick.position.z * STUD_SIZE;

  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);

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

  obj.rotation.y = rotRad;
  obj.position.set(worldX + offsetX, worldY, worldZ + offsetZ);
}

export function updateBrickColor(obj: THREE.Object3D, color: string): void {
  const threeColor = new THREE.Color(color);

  if (obj instanceof THREE.Mesh) {
    // Procedural mesh — single material
    const mat = obj.material as THREE.MeshStandardMaterial;
    mat.color.set(threeColor);
  } else {
    // LDraw group — traverse children
    const edgeColor = threeColor.clone().multiplyScalar(0.5);
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.color.set(threeColor);
      } else if (child instanceof THREE.LineSegments) {
        const mat = child.material as THREE.LineBasicMaterial;
        mat.color.set(edgeColor);
      }
    });
  }
}
