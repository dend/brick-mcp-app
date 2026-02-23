import type { BrickDefinition } from '../types.js';

const slope_2x2: BrickDefinition = {
  id: 'slope_2x2',
  name: '2\u00d72 Slope 45\u00b0',
  category: 'slope',
  studsX: 2,
  studsZ: 2,
  heightUnits: 3,
  // Block-out above the angled face (large Z half in local coords).
  // Studs are on the small Z half (flat top); stacking is allowed there.
  blockout: [{ minX: 0, maxX: 2, minZ: 1, maxZ: 2, height: 3 }],
};

export default slope_2x2;
