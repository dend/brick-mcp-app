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

function BrickApp() {
  const [sceneData, setSceneData] = useState<SceneData | null>(null);
  const [cameraState, setCameraState] = useState<CameraState | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

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
  }, []);

  // Progressive render of brick_render_scene's initialBricks CSV.
  // Host sends healed partial JSON via ontoolinputpartial as the model types.
  // We parse CSV → BrickInstance[] → setSceneData directly. No server round-trip.
  // Server handler places the same bricks into scene.bricks when the tool
  // completes (collision-check idempotent), and the 1s poll reconciles to
  // authoritative state — but during the stream, rendering is pure client-side
  // at delta rate.
  const streamingRef = useRef(false);

  const csvToBricks = (csv: string, dropLast: boolean): BrickInstance[] => {
    const lines = csv.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const safe = dropLast ? lines.slice(0, -1) : lines;
    const out: BrickInstance[] = [];
    for (let i = 0; i < safe.length; i++) {
      const [typeId, xs, ys, zs, rot, col] = safe[i].split(',').map(c => c.trim());
      const x = parseInt(xs, 10), y = parseInt(ys, 10), z = parseInt(zs, 10);
      const r = parseInt(rot || '0', 10);
      if (!typeId || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) continue;
      if (r !== 0 && r !== 90 && r !== 180 && r !== 270) continue;
      out.push({ id: `stream-${i}`, typeId, position: { x, y, z }, rotation: r, color: col || '#cc0000' });
    }
    return out;
  };

  const streamInitialBricks = useCallback((app: App, csv: string, isFinal: boolean) => {
    const bricks = csvToBricks(csv, !isFinal);
    streamingRef.current = !isFinal;
    app.sendLog({ level: 'info', logger: 'BrickApp', data: `stream ${bricks.length} bricks (final=${isFinal})` });
    setSceneData(prev => ({ name: prev?.name ?? 'Untitled', bricks, dynamicTypes: prev?.dynamicTypes }));
  }, []);

  const onAppCreated = useCallback((app: App) => {
    const extractCsv = (p: unknown): string | undefined => {
      // SDK spec says params.arguments, but hosts vary — fall back to params itself
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const any = p as any;
      return any?.arguments?.initialBricks ?? any?.initialBricks;
    };

    app.ontoolinputpartial = (params) => {
      const csv = extractCsv(params);
      app.sendLog({ level: 'info', logger: 'BrickApp', data: `ontoolinputpartial csv=${csv ? csv.length + 'ch' : 'undefined'} keys=${Object.keys(params ?? {}).join(',')}` });
      if (csv) void streamInitialBricks(app, csv, false);
    };

    app.ontoolinput = (params) => {
      const csv = extractCsv(params);
      app.sendLog({ level: 'info', logger: 'BrickApp', data: `ontoolinput csv=${csv ? csv.length + 'ch' : 'undefined'} keys=${Object.keys(params ?? {}).join(',')}` });
      if (csv) void streamInitialBricks(app, csv, true);
    };

    app.ontoolresult = async (result: CallToolResult) => {
      handleToolResult(result);
    };

    app.onerror = console.error;

    app.onhostcontextchanged = (ctx: McpUiHostContext) => {
      setHostContext((prev) => ({ ...prev, ...ctx }));
    };

    app.onteardown = async () => ({ });
  }, [handleToolResult, streamInitialBricks]);

  const { app, error } = useApp({
    appInfo: { name: 'Brick Builder', version: '1.0.0' },
    capabilities: {},
    onAppCreated,
  });

  useHostStyles(app ?? null);

  useEffect(() => {
    if (!app) return;
    setHostContext(app.getHostContext());
  }, [app]);

  // Poll server for scene changes from LLM tool calls
  useEffect(() => {
    if (!app) return;
    const interval = setInterval(async () => {
      if (streamingRef.current) return; // don't clobber mid-stream optimistic render
      try {
        const result = await app.callServerTool({ name: "brick_get_scene", arguments: {} });
        handleToolResult(result);
      } catch { /* ignore */ }
    }, 1000);
    return () => clearInterval(interval);
  }, [app, handleToolResult]);

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
