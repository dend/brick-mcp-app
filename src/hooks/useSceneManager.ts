import { useEffect, useState } from 'react';
import { SceneManager } from '../three/SceneManager';
import { GridHelper } from '../three/GridHelper';
import { SceneReconciler } from '../engine/SceneReconciler';
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

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sceneManager = new SceneManager(container);
    const gridHelper = new GridHelper(sceneManager.scene);
    const reconciler = new SceneReconciler(sceneManager.brickGroup);

    setHandle({ sceneManager, gridHelper, reconciler });

    return () => {
      reconciler.dispose();
      sceneManager.dispose();
      setHandle(null);
    };
  }, [containerRef]);

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
