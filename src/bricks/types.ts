export interface BrickDefinition {
  id: string;
  name: string;
  studsX: number;
  studsZ: number;
  heightUnits: number;
  /**
   * Sparse occupancy map — relative cell offsets {dx, dy, dz} that the part
   * actually occupies within its studsX × heightUnits × studsZ bounding box.
   * When absent, the full rectangular AABB is assumed (standard bricks).
   * Coordinates are in scene space (dx along studsX, dz along studsZ, dy along height).
   */
  occupancyMap?: { dx: number; dy: number; dz: number }[];
}
