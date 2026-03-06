import { useEffect, useState } from 'react';
import type { App } from '@modelcontextprotocol/ext-apps';
import { SceneManager } from '../three/SceneManager';
import { GridHelper } from '../three/GridHelper';
import { SceneReconciler } from '../engine/SceneReconciler';
import { ldrawPartLoader } from '../ldraw/LDrawPartLoader';
import { registerDynamicType, getBrickType } from '../engine/BrickCatalog';
import type { SceneData, CameraState } from '../types';

export interface SceneManagerHandle {
  sceneManager: SceneManager;
  gridHelper: GridHelper;
  reconciler: SceneReconciler;
}

export function useSceneManager(
  app: App | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
  sceneData: SceneData | null,
  cameraState: CameraState | null,
): SceneManagerHandle | null {
  const [handle, setHandle] = useState<SceneManagerHandle | null>(null);
  const [ldrawReady, setLdrawReady] = useState(false);

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sceneManager = new SceneManager(container);
    const gridHelper = new GridHelper(sceneManager.scene);
    const reconciler = new SceneReconciler(sceneManager.brickGroup);

    const h = { sceneManager, gridHelper, reconciler };
    setHandle(h);

    return () => {
      reconciler.dispose();
      sceneManager.dispose();
      setHandle(null);
    };
  }, [containerRef]);

  // Wire the LDraw loader to fetch .dat files through the MCP tool channel.
  // The iframe inside Claude has no HTTP origin, so /ldraw/ fetches would fail.
  useEffect(() => {
    if (!app || ldrawReady) return;
    ldrawPartLoader.init(async (partId) => {
      try {
        const result = await app.callServerTool({ name: 'brick_get_ldraw_files', arguments: { partId } });
        if (result.isError) return null;
        const text = result.content?.find(c => c.type === 'text');
        if (!text || !('text' in text)) return null;
        const payload = JSON.parse(text.text as string) as { files?: Record<string, string> };
        return payload.files ?? null;
      } catch (e) {
        console.warn(`brick_get_ldraw_files(${partId}) failed:`, e);
        return null;
      }
    });
    setLdrawReady(true);
  }, [app, ldrawReady]);

  // Re-reconcile when LDraw becomes ready (upgrades procedural → LDraw meshes)
  useEffect(() => {
    if (!handle || !sceneData || !ldrawReady) return;
    handle.reconciler.reconcile(sceneData.bricks);
  }, [ldrawReady, handle]);

  // Register dynamic types from scene data and trigger async LDraw loads
  useEffect(() => {
    if (!handle || !sceneData?.dynamicTypes) return;

    let needsReReconcile = false;
    const loadPromises: Promise<void>[] = [];

    for (const [typeId, def] of Object.entries(sceneData.dynamicTypes)) {
      if (!getBrickType(typeId)) {
        registerDynamicType(def);
        needsReReconcile = true;
      }
      // Trigger async LDraw load if not already cached
      if (!ldrawPartLoader.getTemplate(typeId)) {
        loadPromises.push(
          ldrawPartLoader.loadPart(typeId).then((result) => {
            if (result) needsReReconcile = true;
          }),
        );
      }
    }

    // Reconcile immediately if we registered new types (procedural fallback)
    if (needsReReconcile) {
      handle.reconciler.reconcile(sceneData.bricks);
    }

    // When LDraw meshes finish loading, re-reconcile to upgrade procedural → LDraw
    if (loadPromises.length > 0) {
      Promise.allSettled(loadPromises).then(() => {
        if (sceneData) handle.reconciler.reconcile(sceneData.bricks);
      });
    }
  }, [sceneData?.dynamicTypes, handle]);

  // Reconcile scene data
  useEffect(() => {
    if (!handle || !sceneData) return;
    handle.reconciler.reconcile(sceneData.bricks);
  }, [sceneData, handle]);

  // Apply camera state
  useEffect(() => {
    if (!handle || !cameraState) return;
    handle.sceneManager.setCamera(cameraState.position, cameraState.target);
  }, [cameraState, handle]);

  return handle;
}
