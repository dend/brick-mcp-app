import * as THREE from 'three';
import type { BrickDefinition } from '../types';
import { createStandardGeometry } from './standard';

const cache = new Map<string, THREE.BufferGeometry>();

export function getBrickGeometry(bt: BrickDefinition): THREE.BufferGeometry {
  const cached = cache.get(bt.id);
  if (cached) return cached;

  const geometry = createStandardGeometry(bt);
  cache.set(bt.id, geometry);
  return geometry;
}
