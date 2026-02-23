import { useEffect, useRef, useCallback } from 'react';
import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { InteractionMode, SceneData } from '../types';
import type { BrickType } from '../types';
import type { SceneManagerHandle } from './useSceneManager';
import { RaycastHelper } from '../three/RaycastHelper';
import { GhostPreview } from '../three/GhostPreview';
import { checkCollisionClient } from '../engine/CollisionDetector';
import { getBrickType } from '../engine/BrickCatalog';
import { BASEPLATE_SIZE } from '../constants';

interface UseInteractionProps {
  app: App | null;
  handle: SceneManagerHandle | null;
  mode: InteractionMode;
  selectedBrickType: BrickType;
  selectedColor: string;
  rotation: 0 | 90 | 180 | 270;
  sceneData: SceneData | null;
  selectedBrickId: string | null;
  onSelect: (id: string | null) => void;
  onRotationChange: (r: 0 | 90 | 180 | 270) => void;
  onToolResult: (result: CallToolResult) => void;
}

interface DragState {
  brickId: string;
  originalPos: { x: number; y: number; z: number };
}

export function useInteraction({
  app,
  handle,
  mode,
  selectedBrickType,
  selectedColor,
  rotation,
  sceneData,
  selectedBrickId,
  onSelect,
  onRotationChange,
  onToolResult,
}: UseInteractionProps) {
  const raycastRef = useRef(new RaycastHelper());
  const ghostRef = useRef<GhostPreview | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastGridRef = useRef<{ x: number; y: number; z: number } | null>(null);

  // Create/destroy ghost preview
  useEffect(() => {
    if (!handle) return;
    ghostRef.current = new GhostPreview(handle.sceneManager.scene);
    return () => {
      ghostRef.current?.dispose();
      ghostRef.current = null;
    };
  }, [handle]);

  // Hide ghost when mode changes
  useEffect(() => {
    ghostRef.current?.hide();
    dragRef.current = null;
    if (handle) {
      handle.sceneManager.controls.enabled = true;
    }
  }, [mode, handle]);

  const callTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (!app) return;
      try {
        const result = await app.callServerTool({ name, arguments: args });
        onToolResult(result);
      } catch (e) {
        console.error(`Tool call ${name} failed:`, e);
      }
    },
    [app, onToolResult],
  );

  useEffect(() => {
    if (!handle) return;
    const canvas = handle.sceneManager.renderer.domElement;
    const raycast = raycastRef.current;
    const bricks = sceneData?.bricks ?? [];

    function getGridHit(event: PointerEvent) {
      raycast.updatePointer(event, canvas);
      return raycast.raycastGrid(
        handle!.sceneManager.camera,
        handle!.gridHelper.raycastPlane,
        handle!.reconciler.getBrickMeshes(),
        selectedBrickType,
      );
    }

    function getBrickHit(event: PointerEvent) {
      raycast.updatePointer(event, canvas);
      return raycast.raycastBricks(
        handle!.sceneManager.camera,
        handle!.reconciler.getBrickMeshes(),
      );
    }

    function isInBounds(x: number, z: number, bt: BrickType, rot: 0 | 90 | 180 | 270): boolean {
      const isRotated = rot === 90 || rot === 270;
      const sx = isRotated ? bt.studsZ : bt.studsX;
      const sz = isRotated ? bt.studsX : bt.studsZ;
      return x >= 0 && z >= 0 && x + sx <= BASEPLATE_SIZE && z + sz <= BASEPLATE_SIZE;
    }

    function onPointerMove(event: PointerEvent) {
      if (mode === 'place') {
        const hit = getGridHit(event);
        if (hit && ghostRef.current) {
          const valid =
            isInBounds(hit.gridX, hit.gridZ, selectedBrickType, rotation) &&
            !checkCollisionClient(bricks, selectedBrickType.id, hit.gridX, hit.gridY, hit.gridZ, rotation);
          ghostRef.current.show(selectedBrickType, hit.gridX, hit.gridY, hit.gridZ, rotation, valid);
          lastGridRef.current = { x: hit.gridX, y: hit.gridY, z: hit.gridZ };
        } else {
          ghostRef.current?.hide();
          lastGridRef.current = null;
        }
      } else if (mode === 'move' && dragRef.current) {
        const hit = getGridHit(event);
        if (hit && ghostRef.current) {
          const dragBrick = bricks.find((b) => b.id === dragRef.current!.brickId);
          if (!dragBrick) return;
          const bt = getBrickType(dragBrick.typeId);
          if (!bt) return;
          const valid =
            isInBounds(hit.gridX, hit.gridZ, bt, dragBrick.rotation) &&
            !checkCollisionClient(bricks, dragBrick.typeId, hit.gridX, hit.gridY, hit.gridZ, dragBrick.rotation, dragBrick.id);
          ghostRef.current.show(bt, hit.gridX, hit.gridY, hit.gridZ, dragBrick.rotation, valid);
          lastGridRef.current = { x: hit.gridX, y: hit.gridY, z: hit.gridZ };
        }
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;

      if (mode === 'place') {
        const hit = getGridHit(event);
        if (!hit) return;
        if (!isInBounds(hit.gridX, hit.gridZ, selectedBrickType, rotation)) return;
        if (checkCollisionClient(bricks, selectedBrickType.id, hit.gridX, hit.gridY, hit.gridZ, rotation)) return;
        callTool('brick_add', {
          typeId: selectedBrickType.id,
          x: hit.gridX,
          y: hit.gridY,
          z: hit.gridZ,
          rotation: String(rotation),
          color: selectedColor,
        });
        return;
      }

      const brickHit = getBrickHit(event);
      if (!brickHit) {
        if (mode === 'select') onSelect(null);
        return;
      }

      const brickId = brickHit.object.userData.brickId as string;
      if (!brickId) return;

      if (mode === 'select') {
        onSelect(brickId);
      } else if (mode === 'delete') {
        callTool('brick_remove', { brickId });
      } else if (mode === 'rotate') {
        const brick = bricks.find((b) => b.id === brickId);
        if (brick) {
          const nextRot = ((brick.rotation + 90) % 360) as 0 | 90 | 180 | 270;
          callTool('brick_rotate', { brickId, rotation: String(nextRot) });
        }
      } else if (mode === 'paint') {
        callTool('brick_paint', { brickId, color: selectedColor });
      } else if (mode === 'move') {
        const brick = bricks.find((b) => b.id === brickId);
        if (brick) {
          dragRef.current = { brickId, originalPos: { ...brick.position } };
          handle!.sceneManager.controls.enabled = false;
          canvas.setPointerCapture(event.pointerId);
          // Hide original mesh during drag
          const mesh = handle!.reconciler.getMeshById(brickId);
          if (mesh) mesh.visible = false;
        }
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (mode === 'move' && dragRef.current) {
        const drag = dragRef.current;
        dragRef.current = null;
        handle!.sceneManager.controls.enabled = true;
        canvas.releasePointerCapture(event.pointerId);

        // Restore original mesh visibility
        const mesh = handle!.reconciler.getMeshById(drag.brickId);
        if (mesh) mesh.visible = true;

        ghostRef.current?.hide();

        if (lastGridRef.current) {
          const { x, y, z } = lastGridRef.current;
          const brick = bricks.find((b) => b.id === drag.brickId);
          if (brick) {
            const bt = getBrickType(brick.typeId);
            if (bt && isInBounds(x, z, bt, brick.rotation) &&
              !checkCollisionClient(bricks, brick.typeId, x, y, z, brick.rotation, drag.brickId)) {
              callTool('brick_move', { brickId: drag.brickId, x, y, z });
            }
          }
        }
        lastGridRef.current = null;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return;

      if (event.key === 'r' || event.key === 'R') {
        onRotationChange(((rotation + 90) % 360) as 0 | 90 | 180 | 270);
      } else if (event.key === 'Delete' && selectedBrickId) {
        callTool('brick_remove', { brickId: selectedBrickId });
        onSelect(null);
      } else if (event.key === 'Escape') {
        onSelect(null);
        if (dragRef.current) {
          const mesh = handle!.reconciler.getMeshById(dragRef.current.brickId);
          if (mesh) mesh.visible = true;
          dragRef.current = null;
          handle!.sceneManager.controls.enabled = true;
          ghostRef.current?.hide();
        }
      }
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [handle, mode, selectedBrickType, selectedColor, rotation, sceneData, selectedBrickId, callTool, onSelect, onRotationChange, onToolResult]);
}
