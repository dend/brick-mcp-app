import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BrickDefinition } from '../types';
import { STUD_SIZE, PLATE_HEIGHT } from '../../constants';
import { createHollowStuds } from './helpers';

export function createSlopeGeometry(bt: BrickDefinition): THREE.BufferGeometry {
  const w = bt.studsX * STUD_SIZE;
  const h = bt.heightUnits * PLATE_HEIGHT;
  const d = bt.studsZ * STUD_SIZE;

  // Pentagon cross-section in shape space (X = depth, Y = height).
  // Low side at X=0 (front), high side at X=d (back).
  //
  //   mid-top _________ back-top
  //           \         |
  //    slope   \        |
  //     face    \       |
  //              \      |
  //   front-wall  \_____|
  //   front-bottom      back-bottom
  //
  const slopeRun = d / 2;
  const slopeShape = new THREE.Shape();
  slopeShape.moveTo(0, 0);                  // front-bottom
  slopeShape.lineTo(d, 0);                  // back-bottom
  slopeShape.lineTo(d, h);                  // back-top
  slopeShape.lineTo(d / 2, h);              // mid-top (front edge of flat top)
  slopeShape.lineTo(0, h - slopeRun);       // slope meets front wall
  slopeShape.closePath();

  const slopeGeo = new THREE.ExtrudeGeometry(slopeShape, {
    depth: w,
    bevelEnabled: false,
  });
  // Rotate so extrusion axis (Z) aligns with world X (width),
  // and shape X axis aligns with world Z (depth).
  // rotateY(-PI/2): x' = -z, z' = x
  slopeGeo.rotateY(-Math.PI / 2);
  slopeGeo.translate(w, 0, 0);

  const parts: THREE.BufferGeometry[] = [slopeGeo];

  // Studs only on back row (last Z row = full-height flat top)
  parts.push(...createHollowStuds(bt.studsX, bt.studsZ, h, { onlyRow: bt.studsZ - 1 }));

  return mergeGeometries(parts.map(g => g.toNonIndexed()))!;
}
