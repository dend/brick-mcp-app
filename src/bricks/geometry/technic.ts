import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BrickDefinition } from '../types';
import { STUD_SIZE, PLATE_HEIGHT } from '../../constants';
import {
  WALL, CURVE_SEG,
  createHollowStuds, createUnderTubes, createRibs, createTechnicWallShape,
} from './helpers';

const PIN_R = 0.3; // pin hole radius (4.8mm diameter)

export function createTechnicGeometry(bt: BrickDefinition): THREE.BufferGeometry {
  const w = bt.studsX * STUD_SIZE;
  const h = bt.heightUnits * PLATE_HEIGHT;
  const d = bt.studsZ * STUD_SIZE;
  const wallH = h - WALL;
  const innerD = d - WALL * 2;

  // Shape coordinates are center-origin (the shape is defined around its own center).
  // The final 3D translate shifts to corner-origin.
  const wallBot = -h / 2;
  const wallTop = h / 2 - WALL;
  const holeCenterY = 0;
  const extSettings: THREE.ExtrudeGeometryOptions = {
    depth: WALL,
    bevelEnabled: false,
    curveSegments: CURVE_SEG,
  };

  const parts: THREE.BufferGeometry[] = [];

  // Top plate
  const topPlate = new THREE.BoxGeometry(w, WALL, d);
  topPlate.translate(w / 2, h - WALL / 2, d / 2);
  parts.push(topPlate);

  // ── Front/back walls (with pin holes between stud columns along X) ──
  const fbHoleCount = bt.studsX - 1;
  if (fbHoleCount > 0) {
    const fbHoles: number[] = [];
    for (let i = 0; i < fbHoleCount; i++) {
      fbHoles.push((i - bt.studsX / 2 + 1) * STUD_SIZE);
    }
    const fbShape = createTechnicWallShape(w, fbHoles, wallBot, wallTop, holeCenterY, PIN_R);

    const frontGeo = new THREE.ExtrudeGeometry(fbShape, extSettings);
    frontGeo.translate(w / 2, h / 2, 0);
    parts.push(frontGeo);

    const backGeo = new THREE.ExtrudeGeometry(fbShape, extSettings);
    backGeo.translate(w / 2, h / 2, d - WALL);
    parts.push(backGeo);
  } else {
    // 1-wide: no holes on short faces, plain box walls
    const fWall = new THREE.BoxGeometry(w, wallH, WALL);
    fWall.translate(w / 2, wallH / 2, WALL / 2);
    parts.push(fWall);

    const bkWall = new THREE.BoxGeometry(w, wallH, WALL);
    bkWall.translate(w / 2, wallH / 2, d - WALL / 2);
    parts.push(bkWall);
  }

  // ── Left/right walls (with pin holes between stud rows along Z) ──
  const lrHoleCount = bt.studsZ - 1;
  if (lrHoleCount > 0) {
    const lrHoles: number[] = [];
    for (let i = 0; i < lrHoleCount; i++) {
      lrHoles.push((i - bt.studsZ / 2 + 1) * STUD_SIZE);
    }
    const lrShape = createTechnicWallShape(innerD, lrHoles, wallBot, wallTop, holeCenterY, PIN_R);

    const leftGeo = new THREE.ExtrudeGeometry(lrShape, extSettings);
    leftGeo.rotateY(Math.PI / 2);
    leftGeo.translate(0, h / 2, d / 2);
    parts.push(leftGeo);

    const rightGeo = new THREE.ExtrudeGeometry(lrShape, extSettings);
    rightGeo.rotateY(Math.PI / 2);
    rightGeo.translate(w - WALL, h / 2, d / 2);
    parts.push(rightGeo);
  } else {
    const lWall = new THREE.BoxGeometry(WALL, wallH, innerD);
    lWall.translate(WALL / 2, wallH / 2, d / 2);
    parts.push(lWall);

    const rWall = new THREE.BoxGeometry(WALL, wallH, innerD);
    rWall.translate(w - WALL / 2, wallH / 2, d / 2);
    parts.push(rWall);
  }

  // Studs, underside tubes, ribs
  parts.push(...createHollowStuds(bt.studsX, bt.studsZ, h));
  parts.push(...createUnderTubes(bt.studsX, bt.studsZ, wallH));
  parts.push(...createRibs(bt.studsX, bt.studsZ, w, d, wallH));

  return mergeGeometries(parts.map(g => g.toNonIndexed()))!;
}
