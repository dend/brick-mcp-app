export interface BrickDefinition {
  id: string;
  name: string;
  category: 'brick' | 'plate' | 'slope' | 'technic' | 'corner';
  studsX: number;
  studsZ: number;
  heightUnits: number;
}
