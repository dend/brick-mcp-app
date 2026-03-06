import type { BrickDefinition } from '../bricks/types';

const dynamicTypes = new Map<string, BrickDefinition>();

export function registerDynamicType(def: BrickDefinition): void {
  dynamicTypes.set(def.id, def);
}

export function getBrickType(typeId: string): BrickDefinition | undefined {
  return dynamicTypes.get(typeId);
}
