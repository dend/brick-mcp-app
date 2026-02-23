import type { InteractionMode } from './types';

export const STUD_SIZE = 1.0;
export const STUD_DIAMETER = 0.6;
export const STUD_HEIGHT = 0.2;
export const PLATE_HEIGHT = 0.4;
export const BRICK_HEIGHT = 1.2;
export const BRICK_GAP = 0.025;
export const BASEPLATE_SIZE = 48;

export const DEFAULT_COLORS: { name: string; hex: string }[] = [
  { name: 'Red', hex: '#cc0000' },
  { name: 'Blue', hex: '#0055bf' },
  { name: 'Green', hex: '#00852b' },
  { name: 'Yellow', hex: '#ffd700' },
  { name: 'White', hex: '#f2f3f2' },
  { name: 'Black', hex: '#1b2a34' },
  { name: 'Orange', hex: '#fe8a18' },
  { name: 'Magenta', hex: '#923978' },
  { name: 'Brown', hex: '#583927' },
  { name: 'Dark Gray', hex: '#6d6e5c' },
  { name: 'Light Gray', hex: '#9ba19d' },
  { name: 'Tan', hex: '#e4cd9e' },
  { name: 'Teal', hex: '#008f9b' },
  { name: 'Pink', hex: '#fc97ac' },
  { name: 'Lime', hex: '#bbd672' },
  { name: 'Peach', hex: '#f9b7a5' },
];

export const INTERACTION_MODES: { mode: InteractionMode; label: string; shortcut: string }[] = [
  { mode: 'look', label: 'Look', shortcut: '1' },
  { mode: 'place', label: 'Place', shortcut: '2' },
  { mode: 'select', label: 'Select', shortcut: '3' },
  { mode: 'move', label: 'Move', shortcut: '4' },
  { mode: 'rotate', label: 'Rotate', shortcut: '5' },
  { mode: 'delete', label: 'Delete', shortcut: '6' },
  { mode: 'paint', label: 'Paint', shortcut: '7' },
];
