import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BrickDefinition } from '../types';
import { STUD_SIZE, PLATE_HEIGHT } from '../../constants';
import { createHollowStuds } from './helpers';

export function createCornerGeometry(bt: BrickDefinition): THREE.BufferGeometry {
  const w = bt.studsX * STUD_SIZE;
  const h = bt.heightUnits * PLATE_HEIGHT;
  const d = bt.studsZ * STUD_SIZE;

  const parts: THREE.BufferGeometry[] = [];

  // L-shaped body: two overlapping boxes, notch at +X,+Z corner.
  // Arm 1: full width, front half of Z
  const arm1 = new THREE.BoxGeometry(w, h, d / 2);
  arm1.translate(w / 2, h / 2, d / 4);
  parts.push(arm1);

  // Arm 2: left half of X, back half of Z
  const arm2 = new THREE.BoxGeometry(w / 2, h, d / 2);
  arm2.translate(w / 4, h / 2, 3 * d / 4);
  parts.push(arm2);

  // Studs — skip notch corner at (studsX-1, studsZ-1)
  parts.push(...createHollowStuds(bt.studsX, bt.studsZ, h, { skipCorner: true }));

  return mergeGeometries(parts.map(g => g.toNonIndexed()))!;
}
