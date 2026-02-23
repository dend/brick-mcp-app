import type { BrickDefinition } from './bricks/types';
export type { BrickDefinition };
export type BrickType = BrickDefinition;

export interface BrickInstance {
  id: string;
  typeId: string;
  position: { x: number; y: number; z: number };
  rotation: 0 | 90 | 180 | 270;
  color: string;
}

export interface CameraState {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export interface SceneData {
  name: string;
  bricks: BrickInstance[];
  camera?: CameraState;
}

export interface ScenePayload {
  scene: SceneData;
  message?: string;
}

export interface AABB {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

export type InteractionMode = 'place' | 'select' | 'move' | 'rotate' | 'delete' | 'paint';
