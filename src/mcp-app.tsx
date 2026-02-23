import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SceneData, CameraState } from './types';
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

  const onAppCreated = useCallback((app: App) => {
    app.ontoolresult = async (result: CallToolResult) => {
      handleToolResult(result);
    };

    app.onerror = console.error;

    app.onhostcontextchanged = (ctx: McpUiHostContext) => {
      setHostContext((prev) => ({ ...prev, ...ctx }));
    };

    app.onteardown = async () => ({ });
  }, [handleToolResult]);

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

  // Poll server for scene changes from LLM tool calls
  useEffect(() => {
    if (!app) return;
    const interval = setInterval(async () => {
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
