import * as THREE from 'three';
import { STUD_SIZE, STUD_DIAMETER, STUD_HEIGHT } from '../../constants';

// Real-brick proportions (from MachineBlocks OpenSCAD reference)
export const WALL = 0.15;       // Wall thickness: 1.2mm / 8mm grid
export const STUD_IR = 0.2;     // Stud inner hole radius: 3.2mm dia
export const TUBE_OR = 0.407;   // Underside tube outer radius: 6.51mm dia
export const TUBE_IR = STUD_DIAMETER / 2; // Tube inner = stud outer: 4.8mm dia
export const RIB_THICKNESS = 0.1;
export const CURVE_SEG = 16;

/**
 * Hollow annular studs on top of a brick (corner-origin coordinates).
 */
export function createHollowStuds(
  studsX: number,
  studsZ: number,
  h: number,
  opts?: {
    skipCorner?: boolean;  // skip stud at (studsX-1, studsZ-1) for corner pieces
    onlyRow?: number;      // only place studs on this Z row index
  },
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];

  const studShape = new THREE.Shape();
  studShape.absarc(0, 0, STUD_DIAMETER / 2, 0, Math.PI * 2, false);
  const studHole = new THREE.Path();
  studHole.absarc(0, 0, STUD_IR, 0, Math.PI * 2, true);
  studShape.holes.push(studHole);

  const baseStudGeo = new THREE.ExtrudeGeometry(studShape, {
    depth: STUD_HEIGHT,
    bevelEnabled: false,
    curveSegments: CURVE_SEG,
  });
  baseStudGeo.rotateX(-Math.PI / 2); // extrude along +Y

  for (let sx = 0; sx < studsX; sx++) {
    for (let sz = 0; sz < studsZ; sz++) {
      if (opts?.skipCorner && sx === studsX - 1 && sz === studsZ - 1) continue;
      if (opts?.onlyRow !== undefined && sz !== opts.onlyRow) continue;
      const stud = baseStudGeo.clone();
      stud.translate(
        (sx + 0.5) * STUD_SIZE,
        h,
        (sz + 0.5) * STUD_SIZE,
      );
      parts.push(stud);
    }
  }

  return parts;
}

/**
 * Top plate + 4 thin walls (corner-origin coordinates).
 */
export function createThinWalls(
  w: number,
  h: number,
  d: number,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const wallH = h - WALL;
  const innerD = d - WALL * 2;

  // Top plate
  const topPlate = new THREE.BoxGeometry(w, WALL, d);
  topPlate.translate(w / 2, h - WALL / 2, d / 2);
  parts.push(topPlate);

  // Front wall (full width)
  const fWall = new THREE.BoxGeometry(w, wallH, WALL);
  fWall.translate(w / 2, wallH / 2, WALL / 2);
  parts.push(fWall);

  // Back wall (full width)
  const bkWall = new THREE.BoxGeometry(w, wallH, WALL);
  bkWall.translate(w / 2, wallH / 2, d - WALL / 2);
  parts.push(bkWall);

  // Left wall (inner depth to avoid corner overlap)
  const lWall = new THREE.BoxGeometry(WALL, wallH, innerD);
  lWall.translate(WALL / 2, wallH / 2, d / 2);
  parts.push(lWall);

  // Right wall (inner depth)
  const rWall = new THREE.BoxGeometry(WALL, wallH, innerD);
  rWall.translate(w - WALL / 2, wallH / 2, d / 2);
  parts.push(rWall);

  return parts;
}

/**
 * Hollow underside tubes for 2+ wide bricks (corner-origin coordinates).
 * Tubes sit at the intersections between stud positions.
 */
export function createUnderTubes(
  studsX: number,
  studsZ: number,
  wallH: number,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];

  if (studsX < 2 || studsZ < 2) return parts;

  const tubeShape = new THREE.Shape();
  tubeShape.absarc(0, 0, TUBE_OR, 0, Math.PI * 2, false);
  const tubeHole = new THREE.Path();
  tubeHole.absarc(0, 0, TUBE_IR, 0, Math.PI * 2, true);
  tubeShape.holes.push(tubeHole);

  const baseTubeGeo = new THREE.ExtrudeGeometry(tubeShape, {
    depth: wallH,
    bevelEnabled: false,
    curveSegments: CURVE_SEG,
  });
  baseTubeGeo.rotateX(-Math.PI / 2); // extrude along +Y

  for (let tx = 0; tx < studsX - 1; tx++) {
    for (let tz = 0; tz < studsZ - 1; tz++) {
      const tube = baseTubeGeo.clone();
      tube.translate(
        (tx + 1) * STUD_SIZE,
        0,
        (tz + 1) * STUD_SIZE,
      );
      parts.push(tube);
    }
  }

  return parts;
}

/**
 * Reinforcement ribs for 1-wide bricks (corner-origin coordinates).
 */
export function createRibs(
  studsX: number,
  studsZ: number,
  w: number,
  d: number,
  wallH: number,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];

  if (studsX === 1 && studsZ >= 2) {
    for (let tz = 0; tz < studsZ - 1; tz++) {
      const rib = new THREE.BoxGeometry(w - WALL * 2, wallH, RIB_THICKNESS);
      rib.translate(w / 2, wallH / 2, (tz + 1) * STUD_SIZE);
      parts.push(rib);
    }
  } else if (studsZ === 1 && studsX >= 2) {
    for (let tx = 0; tx < studsX - 1; tx++) {
      const rib = new THREE.BoxGeometry(RIB_THICKNESS, wallH, d - WALL * 2);
      rib.translate((tx + 1) * STUD_SIZE, wallH / 2, d / 2);
      parts.push(rib);
    }
  }

  return parts;
}

/**
 * Create a rectangular wall shape with circular pin holes (for technic bricks).
 * Shape is in local 2D coordinates centered at origin.
 */
export function createTechnicWallShape(
  wallWidth: number,
  holePositions: number[],
  wallBot: number,
  wallTop: number,
  holeY: number,
  pinR: number,
): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-wallWidth / 2, wallBot);
  shape.lineTo(wallWidth / 2, wallBot);
  shape.lineTo(wallWidth / 2, wallTop);
  shape.lineTo(-wallWidth / 2, wallTop);
  shape.lineTo(-wallWidth / 2, wallBot);
  for (const hp of holePositions) {
    const hole = new THREE.Path();
    hole.absarc(hp, holeY, pinR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return shape;
}
