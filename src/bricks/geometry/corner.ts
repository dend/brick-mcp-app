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

  // L-shaped body: two boxes forming an L, notch at +X,+Z corner.
  // Arm 1: full width, 1-stud front row
  const arm1 = new THREE.BoxGeometry(w, h, STUD_SIZE);
  arm1.translate(w / 2, h / 2, STUD_SIZE / 2);
  parts.push(arm1);

  // Arm 2: 1-stud wide left column, remaining depth
  const arm2Depth = d - STUD_SIZE;
  const arm2 = new THREE.BoxGeometry(STUD_SIZE, h, arm2Depth);
  arm2.translate(STUD_SIZE / 2, h / 2, STUD_SIZE + arm2Depth / 2);
  parts.push(arm2);

  // Studs — skip notch region (sx >= 1 && sz >= 1)
  parts.push(...createHollowStuds(bt.studsX, bt.studsZ, h, { skipNotch: { fromX: 1, fromZ: 1 } }));

  return mergeGeometries(parts.map(g => g.toNonIndexed()))!;
}
