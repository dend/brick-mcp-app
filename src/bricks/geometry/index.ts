import * as THREE from 'three';
import type { BrickDefinition } from '../types';
import { createStandardGeometry } from './standard';
import { createSlopeGeometry } from './slope';
import { createTechnicGeometry } from './technic';
import { createCornerGeometry } from './corner';

const cache = new Map<string, THREE.BufferGeometry>();

export function getBrickGeometry(bt: BrickDefinition): THREE.BufferGeometry {
  const cached = cache.get(bt.id);
  if (cached) return cached;

  let geometry: THREE.BufferGeometry;
  switch (bt.category) {
    case 'slope':   geometry = createSlopeGeometry(bt); break;
    case 'technic': geometry = createTechnicGeometry(bt); break;
    case 'corner':  geometry = createCornerGeometry(bt); break;
    default:        geometry = createStandardGeometry(bt); break;
  }

  cache.set(bt.id, geometry);
  return geometry;
}
