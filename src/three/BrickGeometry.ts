import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BrickType } from '../types';
import { STUD_SIZE, STUD_DIAMETER, STUD_HEIGHT, PLATE_HEIGHT, BRICK_GAP } from '../constants';

const geometryCache = new Map<string, THREE.BufferGeometry>();

export function getBrickGeometry(brickType: BrickType): THREE.BufferGeometry {
  const cached = geometryCache.get(brickType.id);
  if (cached) return cached;

  const geometry = brickType.category === 'slope'
    ? createSlopeGeometry(brickType)
    : createBoxGeometry(brickType);

  geometryCache.set(brickType.id, geometry);
  return geometry;
}

function createBoxGeometry(bt: BrickType): THREE.BufferGeometry {
  const w = bt.studsX * STUD_SIZE - BRICK_GAP * 2;
  const h = bt.heightUnits * PLATE_HEIGHT - BRICK_GAP;
  const d = bt.studsZ * STUD_SIZE - BRICK_GAP * 2;

  const body = new THREE.BoxGeometry(w, h, d);
  body.translate(w / 2 + BRICK_GAP, h / 2, d / 2 + BRICK_GAP);

  const parts: THREE.BufferGeometry[] = [body];

  // Studs on top
  for (let sx = 0; sx < bt.studsX; sx++) {
    for (let sz = 0; sz < bt.studsZ; sz++) {
      const stud = new THREE.CylinderGeometry(STUD_DIAMETER / 2, STUD_DIAMETER / 2, STUD_HEIGHT, 12);
      stud.translate(
        sx * STUD_SIZE + STUD_SIZE / 2,
        h + STUD_HEIGHT / 2,
        sz * STUD_SIZE + STUD_SIZE / 2,
      );
      parts.push(stud);
    }
  }

  return mergeGeometries(parts)!;
}

function createSlopeGeometry(bt: BrickType): THREE.BufferGeometry {
  const w = bt.studsX * STUD_SIZE - BRICK_GAP * 2;
  const h = bt.heightUnits * PLATE_HEIGHT - BRICK_GAP;
  const d = bt.studsZ * STUD_SIZE - BRICK_GAP * 2;

  // Triangular cross-section (slope going along Z)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(d, 0);
  shape.lineTo(d, h);
  shape.lineTo(0, 0);

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    steps: 1,
    depth: w,
    bevelEnabled: false,
  };
  const slopeGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  // Rotate from extrude orientation to world: extruded along X, shape in YZ
  slopeGeo.rotateY(Math.PI / 2);
  slopeGeo.translate(w + BRICK_GAP, 0, BRICK_GAP);

  const parts: THREE.BufferGeometry[] = [slopeGeo];

  // Studs only on the back row (last Z row)
  const lastZ = bt.studsZ - 1;
  for (let sx = 0; sx < bt.studsX; sx++) {
    const stud = new THREE.CylinderGeometry(STUD_DIAMETER / 2, STUD_DIAMETER / 2, STUD_HEIGHT, 12);
    stud.translate(
      sx * STUD_SIZE + STUD_SIZE / 2,
      h + STUD_HEIGHT / 2,
      lastZ * STUD_SIZE + STUD_SIZE / 2,
    );
    parts.push(stud);
  }

  return mergeGeometries(parts)!;
}
