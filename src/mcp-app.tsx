import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SceneData, CameraState, BrickInstance } from './types';
import BrickBuilder from './components/BrickBuilder';
import './global.css';

function parseScenePayload(result: CallToolResult): { scene?: SceneData; camera?: CameraState; message?: string } | null {
  const textContent = result.content?.find((c) => c.type === 'text');
  if (!textContent || !('text' in textContent)) return null;
  try {
    return JSON.parse(textContent.text as string);
  } catch {
    return null;
  }
}

// Parse a potentially-incomplete JSON array string (streamed from LLM).
// Finds the last closing brace and truncates there, then retries parse.
function parsePartialBricks(str: string | undefined): Array<{ typeId: string; x: number; y: number; z: number; rotation?: string; color?: string }> {
  if (!str?.trim().startsWith('[')) return [];
  try { return JSON.parse(str); } catch { /* partial */ }
  const last = str.lastIndexOf('}');
  if (last < 0) return [];
  try { return JSON.parse(str.substring(0, last + 1) + ']'); } catch { /* incomplete */ }
  return [];
}

// Convert raw streamed brick data into BrickInstance objects with temporary IDs
function rawToBrickInstances(raw: Array<{ typeId: string; x: number; y: number; z: number; rotation?: string; color?: string }>): BrickInstance[] {
  return raw.map((b, i) => ({
    id: `_stream_${i}`,
    typeId: b.typeId,
    position: { x: b.x ?? 0, y: b.y ?? 0, z: b.z ?? 0 },
    rotation: (Number(b.rotation ?? '0') as 0 | 90 | 180 | 270),
    color: b.color ?? '#cc0000',
  }));
}

function BrickApp() {
  const [sceneData, setSceneData] = useState<SceneData | null>(null);
  const [cameraState, setCameraState] = useState<CameraState | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();
  // Snapshot of scene bricks before streaming started — used to merge streaming bricks
  const preStreamBricksRef = useRef<BrickInstance[] | null>(null);
  // Track current scene data for use in callbacks
  const sceneDataRef = useRef<SceneData | null>(null);
  sceneDataRef.current = sceneData;

  // Central handler for ALL tool results — both host-initiated and app-initiated
  const handleToolResult = useCallback((result: CallToolResult) => {
    const payload = parseScenePayload(result);
    if (!payload) return;
    if (payload.scene) {
      setSceneData(payload.scene);
    }
    if (payload.camera) {
      setCameraState(payload.camera);
    }
    // Streaming is done — clear the pre-stream snapshot
    preStreamBricksRef.current = null;
  }, []);

  // Apply streamed bricks to the scene — merges base bricks with streaming ones.
  // `params` has shape { arguments?: Record<string, unknown> } per the SDK spec.
  const applyStreamingBricks = useCallback((params: { arguments?: Record<string, unknown> }, dropLast: boolean) => {
    const bricksJson = params.arguments?.bricks as string | undefined;
    if (!bricksJson) return;

    let raw = parsePartialBricks(bricksJson);
    if (raw.length === 0) return;

    // Drop last element during partial streaming — it may be incomplete
    if (dropLast && raw.length > 1) {
      raw = raw.slice(0, -1);
    }

    // Snapshot the base scene on first streaming update
    if (preStreamBricksRef.current === null) {
      preStreamBricksRef.current = sceneDataRef.current?.bricks ?? [];
    }

    const clearFirst = params.arguments?.clearFirst as boolean | undefined;
    const baseBricks = clearFirst ? [] : preStreamBricksRef.current;
    const streamBricks = rawToBrickInstances(raw);

    setSceneData((prev) => ({
      name: prev?.name ?? 'Untitled',
      bricks: [...baseBricks, ...streamBricks],
    }));
  }, []);

  const onAppCreated = useCallback((app: App) => {
    app.ontoolresult = async (result: CallToolResult) => {
      handleToolResult(result);
    };

    // Partial streaming: LLM is still generating the bricks JSON
    app.ontoolinputpartial = async (input) => {
      applyStreamingBricks(input, true);
    };

    // Final input: LLM has finished generating, but server hasn't processed yet
    app.ontoolinput = async (input) => {
      applyStreamingBricks(input, false);
    };

    app.ontoolcancelled = () => {
      // If cancelled mid-stream, revert to pre-stream state
      if (preStreamBricksRef.current !== null) {
        setSceneData((prev) => ({
          name: prev?.name ?? 'Untitled',
          bricks: preStreamBricksRef.current!,
        }));
        preStreamBricksRef.current = null;
      }
    };

    app.onerror = console.error;

    app.onhostcontextchanged = (ctx: McpUiHostContext) => {
      setHostContext((prev) => ({ ...prev, ...ctx }));
    };

    app.onteardown = async () => ({ });
  }, [handleToolResult, applyStreamingBricks]);

  const { app, error } = useApp({
    appInfo: { name: 'Brick Builder', version: '1.0.0' },
    capabilities: {},
    onAppCreated,
  });

  useHostStyles(app ?? null);

  // Request fullscreen on mount
  useEffect(() => {
    if (!app) return;
    setHostContext(app.getHostContext());
    app.requestDisplayMode({ mode: 'fullscreen' }).catch(() => {});
  }, [app]);

  // Update model context when scene changes
  useEffect(() => {
    if (!app || !sceneData) return;
    app.updateModelContext({
      content: [{ type: 'text', text: `Brick Builder scene '${sceneData.name}': ${sceneData.bricks.length} bricks` }],
    }).catch(() => {});
  }, [app, sceneData]);

  if (error) {
    return (
      <div style={{ padding: 20, color: '#ff4444' }}>
        <strong>Connection error:</strong> {error.message}
      </div>
    );
  }

  if (!app) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa' }}>
        Connecting to host...
      </div>
    );
  }

  return (
    <main
      style={{
        width: '100%',
        height: '100%',
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <BrickBuilder app={app} sceneData={sceneData} cameraState={cameraState} onToolResult={handleToolResult} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrickApp />
  </StrictMode>,
);
