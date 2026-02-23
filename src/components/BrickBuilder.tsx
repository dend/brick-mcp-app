import { useRef, useState, useCallback, useEffect } from 'react';
import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { InteractionMode, SceneData, CameraState, BrickType } from '../types';
import { DEFAULT_COLORS, INTERACTION_MODES } from '../constants';
import { BRICK_CATALOG } from '../engine/BrickCatalog';
import { useSceneManager } from '../hooks/useSceneManager';
import { useInteraction } from '../hooks/useInteraction';
import ThreeCanvas from './ThreeCanvas';
import Toolbar from './Toolbar';
import BrickSelector from './BrickSelector';
import ColorPicker from './ColorPicker';
import SceneInfo from './SceneInfo';

interface BrickBuilderProps {
  app: App | null;
  sceneData: SceneData | null;
  cameraState: CameraState | null;
  onToolResult: (result: CallToolResult) => void;
}

export default function BrickBuilder({ app, sceneData, cameraState, onToolResult }: BrickBuilderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<InteractionMode>('place');
  const [selectedBrickType, setSelectedBrickType] = useState<BrickType>(BRICK_CATALOG[8]); // 2x4 brick
  const [selectedColor, setSelectedColor] = useState(DEFAULT_COLORS[0].hex);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [selectedBrickId, setSelectedBrickId] = useState<string | null>(null);

  const handle = useSceneManager(containerRef, sceneData, cameraState);

  // Keyboard shortcut for mode switching
  const handleModeChange = useCallback((newMode: InteractionMode) => {
    setMode(newMode);
    setSelectedBrickId(null);
    if (handle) {
      handle.reconciler.setHighlight(null);
    }
  }, [handle]);

  const handleSelect = useCallback(
    (id: string | null) => {
      setSelectedBrickId(id);
      if (handle) {
        handle.reconciler.setHighlight(id);
      }
    },
    [handle],
  );

  // Keyboard shortcut: 1-6 for modes
  // This is handled inside useInteraction

  useInteraction({
    app,
    handle,
    mode,
    selectedBrickType,
    selectedColor,
    rotation,
    sceneData,
    selectedBrickId,
    onSelect: handleSelect,
    onRotationChange: setRotation,
    onToolResult,
  });

  // Also handle mode shortcuts at this level
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const idx = INTERACTION_MODES.findIndex((m) => m.shortcut === e.key);
      if (idx !== -1) {
        handleModeChange(INTERACTION_MODES[idx].mode);
      }
    },
    [handleModeChange],
  );

  // Register mode keyboard shortcuts
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ThreeCanvas ref={containerRef} />
      <Toolbar mode={mode} onModeChange={handleModeChange} />
      <BrickSelector
        catalog={BRICK_CATALOG}
        selectedType={selectedBrickType}
        onSelect={setSelectedBrickType}
        visible={mode === 'place'}
      />
      <ColorPicker
        selectedColor={selectedColor}
        onColorChange={setSelectedColor}
        visible={mode === 'place' || mode === 'paint'}
      />
      <SceneInfo app={app} sceneData={sceneData} onToolResult={onToolResult} />
      {/* Rotation indicator */}
      {mode === 'place' && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)',
          borderRadius: 6,
          padding: '4px 10px',
          color: '#fff',
          fontSize: 11,
          zIndex: 10,
          opacity: 0.8,
        }}>
          {selectedBrickType.name} · {rotation}° · Press R to rotate
        </div>
      )}
    </div>
  );
}
