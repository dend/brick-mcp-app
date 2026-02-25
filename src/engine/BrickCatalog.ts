import type { BrickDefinition } from '../bricks/types';

export { BRICK_CATALOG, getBrickTypesByCategory } from '../bricks/catalog';
import { getBrickType as getCatalogBrickType } from '../bricks/catalog';

const dynamicTypes = new Map<string, BrickDefinition>();

export function registerDynamicType(def: BrickDefinition): void {
  dynamicTypes.set(def.id, def);
}

export function getBrickType(typeId: string): BrickDefinition | undefined {
  return getCatalogBrickType(typeId) ?? dynamicTypes.get(typeId);
}
