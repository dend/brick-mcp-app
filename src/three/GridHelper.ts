import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BASEPLATE_SIZE, STUD_SIZE, STUD_DIAMETER, STUD_HEIGHT } from '../constants';

export class GridHelper {
  baseplate: THREE.Mesh;
  grid: THREE.GridHelper;
  raycastPlane: THREE.Mesh;
  border: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const size = BASEPLATE_SIZE * STUD_SIZE;

    // Green baseplate body + studs
    const baseplateGeo = new THREE.BoxGeometry(size, 0.2, size);
    baseplateGeo.translate(size / 2, -0.1, size / 2);

    // Generate studs on the baseplate
    const studParts: THREE.BufferGeometry[] = [baseplateGeo];
    const studGeo = new THREE.CylinderGeometry(STUD_DIAMETER / 2, STUD_DIAMETER / 2, STUD_HEIGHT, 8);
    for (let sx = 0; sx < BASEPLATE_SIZE; sx++) {
      for (let sz = 0; sz < BASEPLATE_SIZE; sz++) {
        const stud = studGeo.clone();
        stud.translate(
          sx * STUD_SIZE + STUD_SIZE / 2,
          STUD_HEIGHT / 2,
          sz * STUD_SIZE + STUD_SIZE / 2,
        );
        studParts.push(stud);
      }
    }
    const mergedGeo = mergeGeometries(studParts)!;

    const baseplateMat = new THREE.MeshStandardMaterial({ color: 0x4a7c59, roughness: 0.8 });
    this.baseplate = new THREE.Mesh(mergedGeo, baseplateMat);
    this.baseplate.receiveShadow = true;
    scene.add(this.baseplate);

    // Raised border around baseplate edge
    const borderHeight = 0.5;
    const borderWidth = 0.2 * STUD_SIZE;
    const borderY = borderHeight / 2;
    const borderMat = new THREE.MeshStandardMaterial({ color: 0x1e3a28, roughness: 0.7 });
    const borderParts: THREE.BufferGeometry[] = [];

    // Front edge (Z = 0)
    const front = new THREE.BoxGeometry(size + borderWidth * 2, borderHeight, borderWidth);
    front.translate(size / 2, borderY, -borderWidth / 2);
    borderParts.push(front);

    // Back edge (Z = size)
    const back = new THREE.BoxGeometry(size + borderWidth * 2, borderHeight, borderWidth);
    back.translate(size / 2, borderY, size + borderWidth / 2);
    borderParts.push(back);

    // Left edge (X = 0)
    const left = new THREE.BoxGeometry(borderWidth, borderHeight, size);
    left.translate(-borderWidth / 2, borderY, size / 2);
    borderParts.push(left);

    // Right edge (X = size)
    const right = new THREE.BoxGeometry(borderWidth, borderHeight, size);
    right.translate(size + borderWidth / 2, borderY, size / 2);
    borderParts.push(right);

    const borderGeo = mergeGeometries(borderParts)!;
    this.border = new THREE.Mesh(borderGeo, borderMat);
    this.border.receiveShadow = true;
    scene.add(this.border);

    // Grid lines
    this.grid = new THREE.GridHelper(size, BASEPLATE_SIZE, 0x000000, 0x000000);
    this.grid.position.set(size / 2, 0.001, size / 2);
    (this.grid.material as THREE.Material).opacity = 0.15;
    (this.grid.material as THREE.Material).transparent = true;
    scene.add(this.grid);

    // Invisible raycast plane at Y=0
    const planeGeo = new THREE.PlaneGeometry(size, size);
    const planeMat = new THREE.MeshBasicMaterial({ visible: false });
    this.raycastPlane = new THREE.Mesh(planeGeo, planeMat);
    this.raycastPlane.rotation.x = -Math.PI / 2;
    this.raycastPlane.position.set(size / 2, 0, size / 2);
    scene.add(this.raycastPlane);
  }
}
