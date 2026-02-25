import { useEffect, useState } from 'react';
import { SceneManager } from '../three/SceneManager';
import { GridHelper } from '../three/GridHelper';
import { SceneReconciler } from '../engine/SceneReconciler';
import { ldrawPartLoader } from '../ldraw/LDrawPartLoader';
import { LDRAW_FILES } from '../ldraw/ldraw-bundle';
import { BRICK_CATALOG } from '../bricks/catalog';
import type { SceneData, CameraState } from '../types';

export interface SceneManagerHandle {
  sceneManager: SceneManager;
  gridHelper: GridHelper;
  reconciler: SceneReconciler;
}

export function useSceneManager(
  containerRef: React.RefObject<HTMLDivElement | null>,
  sceneData: SceneData | null,
  cameraState: CameraState | null,
): SceneManagerHandle | null {
  const [handle, setHandle] = useState<SceneManagerHandle | null>(null);
  const [ldrawReady, setLdrawReady] = useState(false);

  // Initialize Three.js scene and LDraw loader
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sceneManager = new SceneManager(container);
    const gridHelper = new GridHelper(sceneManager.scene);
    const reconciler = new SceneReconciler(sceneManager.brickGroup);

    const h = { sceneManager, gridHelper, reconciler };
    setHandle(h);

    // Init LDraw loader in parallel — scene works immediately with procedural fallback
    const initLDraw = async () => {
      try {
        const hasFiles = Object.keys(LDRAW_FILES).length > 0;
        await ldrawPartLoader.init({
          embeddedFiles: hasFiles ? LDRAW_FILES : undefined,
        });
        if (hasFiles) {
          await ldrawPartLoader.preloadParts(BRICK_CATALOG.map(b => b.id));
        }
        setLdrawReady(true);
      } catch (e) {
        console.warn('LDraw initialization failed, using procedural fallback', e);
      }
    };

    initLDraw();

    return () => {
      reconciler.dispose();
      sceneManager.dispose();
      setHandle(null);
    };
  }, [containerRef]);

  // Re-reconcile when LDraw becomes ready (upgrades procedural → LDraw meshes)
  useEffect(() => {
    if (!handle || !sceneData || !ldrawReady) return;
    handle.reconciler.reconcile(sceneData.bricks);
  }, [ldrawReady, handle]);

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
