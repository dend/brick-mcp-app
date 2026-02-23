import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BrickDefinition } from '../types';
import { STUD_SIZE, PLATE_HEIGHT } from '../../constants';
import { WALL, createHollowStuds, createThinWalls, createUnderTubes, createRibs } from './helpers';

export function createStandardGeometry(bt: BrickDefinition): THREE.BufferGeometry {
  const w = bt.studsX * STUD_SIZE;
  const h = bt.heightUnits * PLATE_HEIGHT;
  const d = bt.studsZ * STUD_SIZE;
  const wallH = h - WALL;

  const parts: THREE.BufferGeometry[] = [
    ...createThinWalls(w, h, d),
    ...createHollowStuds(bt.studsX, bt.studsZ, h),
    ...createUnderTubes(bt.studsX, bt.studsZ, wallH),
    ...createRibs(bt.studsX, bt.studsZ, w, d, wallH),
  ];

  return mergeGeometries(parts.map(g => g.toNonIndexed()))!;
}
