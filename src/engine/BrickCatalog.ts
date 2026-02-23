import type { BrickType } from '../types';

export const BRICK_CATALOG: BrickType[] = [
  // Bricks (heightUnits=3)
  { id: 'brick_1x1', name: '1×1 Brick', category: 'brick', studsX: 1, studsZ: 1, heightUnits: 3 },
  { id: 'brick_1x2', name: '1×2 Brick', category: 'brick', studsX: 1, studsZ: 2, heightUnits: 3 },
  { id: 'brick_1x3', name: '1×3 Brick', category: 'brick', studsX: 1, studsZ: 3, heightUnits: 3 },
  { id: 'brick_1x4', name: '1×4 Brick', category: 'brick', studsX: 1, studsZ: 4, heightUnits: 3 },
  { id: 'brick_1x6', name: '1×6 Brick', category: 'brick', studsX: 1, studsZ: 6, heightUnits: 3 },
  { id: 'brick_1x8', name: '1×8 Brick', category: 'brick', studsX: 1, studsZ: 8, heightUnits: 3 },
  { id: 'brick_2x2', name: '2×2 Brick', category: 'brick', studsX: 2, studsZ: 2, heightUnits: 3 },
  { id: 'brick_2x3', name: '2×3 Brick', category: 'brick', studsX: 2, studsZ: 3, heightUnits: 3 },
  { id: 'brick_2x4', name: '2×4 Brick', category: 'brick', studsX: 2, studsZ: 4, heightUnits: 3 },
  { id: 'brick_2x6', name: '2×6 Brick', category: 'brick', studsX: 2, studsZ: 6, heightUnits: 3 },
  { id: 'brick_2x8', name: '2×8 Brick', category: 'brick', studsX: 2, studsZ: 8, heightUnits: 3 },

  // Plates (heightUnits=1)
  { id: 'plate_1x1', name: '1×1 Plate', category: 'plate', studsX: 1, studsZ: 1, heightUnits: 1 },
  { id: 'plate_1x2', name: '1×2 Plate', category: 'plate', studsX: 1, studsZ: 2, heightUnits: 1 },
  { id: 'plate_1x4', name: '1×4 Plate', category: 'plate', studsX: 1, studsZ: 4, heightUnits: 1 },
  { id: 'plate_2x2', name: '2×2 Plate', category: 'plate', studsX: 2, studsZ: 2, heightUnits: 1 },
  { id: 'plate_2x4', name: '2×4 Plate', category: 'plate', studsX: 2, studsZ: 4, heightUnits: 1 },
  { id: 'plate_2x6', name: '2×6 Plate', category: 'plate', studsX: 2, studsZ: 6, heightUnits: 1 },
  { id: 'plate_4x4', name: '4×4 Plate', category: 'plate', studsX: 4, studsZ: 4, heightUnits: 1 },

  // Slopes (heightUnits=3)
  { id: 'slope_2x2', name: '2×2 Slope 45°', category: 'slope', studsX: 2, studsZ: 2, heightUnits: 3 },

  // Technic (heightUnits=3, with pin holes)
  { id: 'technic_1x2', name: '1×2 Technic', category: 'technic', studsX: 1, studsZ: 2, heightUnits: 3 },
  { id: 'technic_1x4', name: '1×4 Technic', category: 'technic', studsX: 1, studsZ: 4, heightUnits: 3 },
  { id: 'technic_1x6', name: '1×6 Technic', category: 'technic', studsX: 1, studsZ: 6, heightUnits: 3 },
  { id: 'technic_1x8', name: '1×8 Technic', category: 'technic', studsX: 1, studsZ: 8, heightUnits: 3 },
  { id: 'technic_2x4', name: '2×4 Technic', category: 'technic', studsX: 2, studsZ: 4, heightUnits: 3 },

  // Corner plates (L-shaped, heightUnits=1)
  { id: 'corner_2x2', name: '2×2 Corner', category: 'corner', studsX: 2, studsZ: 2, heightUnits: 1 },
];

export function getBrickType(typeId: string): BrickType | undefined {
  return BRICK_CATALOG.find(bt => bt.id === typeId);
}

export function getBrickTypesByCategory(category: BrickType['category']): BrickType[] {
  return BRICK_CATALOG.filter(bt => bt.category === category);
}
