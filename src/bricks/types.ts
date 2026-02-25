export interface BlockoutZone {
  minX: number; maxX: number;  // local stud coordinates
  minZ: number; maxZ: number;  // local stud coordinates
  height: number;              // heightUnits above the brick's top
}

export interface BrickDefinition {
  id: string;
  name: string;
  category: 'brick' | 'plate' | 'slope' | 'technic' | 'corner' | 'generic';
  studsX: number;
  studsZ: number;
  heightUnits: number;
  blockout?: BlockoutZone[];
}
