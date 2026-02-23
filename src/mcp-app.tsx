import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SceneData, CameraState } from './types';
import BrickBuilder from './components/BrickBuilder';
import './global.css';

function parseScenePayload(result: CallToolResult): { scene?: SceneData; camera?: CameraState; message?: string; version?: number; unchanged?: boolean } | null {
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
  const knownVersionRef = useRef<number | undefined>(undefined);
  // Timestamp of last direct (non-poll) tool result — used to suppress polling briefly
  const lastDirectResultRef = useRef<number>(0);

  // Central handler for ALL tool results — both host-initiated and app-initiated
  const handleToolResult = useCallback((result: CallToolResult) => {
    const payload = parseScenePayload(result);
    if (!payload) return;
    // Skip stale results — don't let an older version overwrite a newer one
    if (payload.version !== undefined && knownVersionRef.current !== undefined
        && payload.version < knownVersionRef.current) {
      return;
    }
    if (payload.version !== undefined) {
      knownVersionRef.current = payload.version;
    }
    if (payload.scene) {
      setSceneData(payload.scene);
    }
    if (payload.camera) {
      setCameraState(payload.camera);
    }
    // Mark that a direct tool result was just processed
    lastDirectResultRef.current = Date.now();
  }, []);

  const onAppCreated = useCallback((app: App) => {
    app.ontoolresult = async (result: CallToolResult) => {
      handleToolResult(result);
    };

    app.ontoolinput = async () => {};

    app.ontoolcancelled = () => {};

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

  // Update model context when scene changes
  useEffect(() => {
    if (!app || !sceneData) return;
    app.updateModelContext({
      content: [{ type: 'text', text: `Brick Builder scene '${sceneData.name}': ${sceneData.bricks.length} bricks` }],
    }).catch(() => {});
  }, [app, sceneData]);

  // Poll for scene changes (picks up model-initiated mutations).
  // Uses adaptive timing: re-polls quickly when changes are detected (live building),
  // falls back to 1s interval when idle.
  useEffect(() => {
    if (!app) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      // Skip poll if a direct tool result was processed very recently
      if (Date.now() - lastDirectResultRef.current < 500) {
        timeoutId = setTimeout(poll, 200);
        return;
      }
      try {
        const result = await app!.callServerTool({
          name: 'brick_poll_scene',
          arguments: { knownVersion: knownVersionRef.current },
        });
        if (cancelled) return;
        const payload = parseScenePayload(result);
        if (!payload || payload.unchanged) {
          // No changes — poll at normal rate
          timeoutId = setTimeout(poll, 1000);
          return;
        }
        // Skip stale poll results
        if (payload.version !== undefined && knownVersionRef.current !== undefined
            && payload.version < knownVersionRef.current) {
          timeoutId = setTimeout(poll, 1000);
          return;
        }
        // Also skip if a direct result arrived while this poll was in-flight
        if (Date.now() - lastDirectResultRef.current < 500) {
          timeoutId = setTimeout(poll, 200);
          return;
        }
        if (payload.version !== undefined) {
          knownVersionRef.current = payload.version;
        }
        if (payload.scene) {
          setSceneData(payload.scene);
        }
        // Changes detected — re-poll quickly for live building effect
        timeoutId = setTimeout(poll, 50);
      } catch {
        if (cancelled) return;
        timeoutId = setTimeout(poll, 1000);
      }
    }

    timeoutId = setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [app]);

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
