import type { BrickDefinition } from './types.js';

/**
 * Brick catalog using LDraw part numbers as canonical IDs.
 *
 * Each entry's `id` is the official LDraw part number (e.g., "3001" = Brick 2x4).
 * studsX/studsZ/heightUnits are used for collision/support detection.
 * Category drives procedural fallback geometry and server-side L-shape handling.
 */
export const BRICK_CATALOG: BrickDefinition[] = [
  // ── Standard Bricks (heightUnits = 3) ──────────────────────────────────
  { id: '3005', name: 'Brick 1x1',  category: 'brick', studsX: 1, studsZ: 1, heightUnits: 3 },
  { id: '3004', name: 'Brick 1x2',  category: 'brick', studsX: 1, studsZ: 2, heightUnits: 3 },
  { id: '3622', name: 'Brick 1x3',  category: 'brick', studsX: 1, studsZ: 3, heightUnits: 3 },
  { id: '3010', name: 'Brick 1x4',  category: 'brick', studsX: 1, studsZ: 4, heightUnits: 3 },
  { id: '3009', name: 'Brick 1x6',  category: 'brick', studsX: 1, studsZ: 6, heightUnits: 3 },
  { id: '3008', name: 'Brick 1x8',  category: 'brick', studsX: 1, studsZ: 8, heightUnits: 3 },
  { id: '3003', name: 'Brick 2x2',  category: 'brick', studsX: 2, studsZ: 2, heightUnits: 3 },
  { id: '3002', name: 'Brick 2x3',  category: 'brick', studsX: 2, studsZ: 3, heightUnits: 3 },
  { id: '3001', name: 'Brick 2x4',  category: 'brick', studsX: 2, studsZ: 4, heightUnits: 3 },
  { id: '2456', name: 'Brick 2x6',  category: 'brick', studsX: 2, studsZ: 6, heightUnits: 3 },
  { id: '3007', name: 'Brick 2x8',  category: 'brick', studsX: 2, studsZ: 8, heightUnits: 3 },

  // ── Plates (heightUnits = 1) ───────────────────────────────────────────
  { id: '3024', name: 'Plate 1x1',  category: 'plate', studsX: 1, studsZ: 1, heightUnits: 1 },
  { id: '3023', name: 'Plate 1x2',  category: 'plate', studsX: 1, studsZ: 2, heightUnits: 1 },
  { id: '3710', name: 'Plate 1x4',  category: 'plate', studsX: 1, studsZ: 4, heightUnits: 1 },
  { id: '3022', name: 'Plate 2x2',  category: 'plate', studsX: 2, studsZ: 2, heightUnits: 1 },
  { id: '3020', name: 'Plate 2x4',  category: 'plate', studsX: 2, studsZ: 4, heightUnits: 1 },
  { id: '3795', name: 'Plate 2x6',  category: 'plate', studsX: 2, studsZ: 6, heightUnits: 1 },
  { id: '3031', name: 'Plate 4x4',  category: 'plate', studsX: 4, studsZ: 4, heightUnits: 1 },
  { id: '3958', name: 'Plate 6x6',  category: 'plate', studsX: 6, studsZ: 6, heightUnits: 1 },
  { id: '3036', name: 'Plate 6x8',  category: 'plate', studsX: 6, studsZ: 8, heightUnits: 1 },
  { id: '3035', name: 'Plate 4x8',  category: 'plate', studsX: 4, studsZ: 8, heightUnits: 1 },
  { id: '4477', name: 'Plate 1x10', category: 'plate', studsX: 1, studsZ: 10, heightUnits: 1 },

  // ── Slope (heightUnits = 3) ────────────────────────────────────────────
  {
    id: '3039', name: 'Slope 45 2x2', category: 'slope', studsX: 2, studsZ: 2, heightUnits: 3,
    blockout: [{ minX: 0, maxX: 2, minZ: 0, maxZ: 1, height: 3 }],
  },

  // ── Technic Bricks (heightUnits = 3) ───────────────────────────────────
  { id: '3700', name: 'Technic Brick 1x2', category: 'technic', studsX: 1, studsZ: 2, heightUnits: 3 },
  { id: '3701', name: 'Technic Brick 1x4', category: 'technic', studsX: 1, studsZ: 4, heightUnits: 3 },
  { id: '3894', name: 'Technic Brick 1x6', category: 'technic', studsX: 1, studsZ: 6, heightUnits: 3 },
  { id: '3702', name: 'Technic Brick 1x8', category: 'technic', studsX: 1, studsZ: 8, heightUnits: 3 },
  { id: '3709', name: 'Technic Brick 2x4', category: 'technic', studsX: 2, studsZ: 4, heightUnits: 3 },

  // ── Corner Bricks (heightUnits = 3) ────────────────────────────────────
  { id: '2357', name: 'Corner Brick 2x2', category: 'corner', studsX: 2, studsZ: 2, heightUnits: 3 },
  { id: '2462', name: 'Corner Brick 3x3', category: 'corner', studsX: 3, studsZ: 3, heightUnits: 3 },
];

export function getBrickType(typeId: string): BrickDefinition | undefined {
  return BRICK_CATALOG.find(bt => bt.id === typeId);
}

export function getBrickTypesByCategory(category: BrickDefinition['category']): BrickDefinition[] {
  return BRICK_CATALOG.filter(bt => bt.category === category);
}
