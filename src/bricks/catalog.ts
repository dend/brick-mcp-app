import type { BrickDefinition } from './types.js';
import * as definitions from './definitions/index.js';

export const BRICK_CATALOG: BrickDefinition[] = Object.values(definitions);

export function getBrickType(typeId: string): BrickDefinition | undefined {
  return BRICK_CATALOG.find(bt => bt.id === typeId);
}

export function getBrickTypesByCategory(category: BrickDefinition['category']): BrickDefinition[] {
  return BRICK_CATALOG.filter(bt => bt.category === category);
}
