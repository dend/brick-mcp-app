import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SceneData } from '../types';

interface SceneInfoProps {
  app: App | null;
  sceneData: SceneData | null;
  onToolResult: (result: CallToolResult) => void;
}

export default function SceneInfo({ app, sceneData, onToolResult }: SceneInfoProps) {
  const name = sceneData?.name ?? 'Untitled';
  const count = sceneData?.bricks.length ?? 0;

  async function callTool(toolName: string, args: Record<string, unknown>) {
    if (!app) return null;
    try {
      const result = await app.callServerTool({ name: toolName, arguments: args });
      onToolResult(result);
      return result;
    } catch (e) {
      console.error(`Tool call ${toolName} failed:`, e);
      return null;
    }
  }

  return (
    <div style={{
      position: 'absolute',
      top: 8,
      right: 8,
      background: 'rgba(0,0,0,0.7)',
      borderRadius: 8,
      padding: '6px 10px',
      zIndex: 10,
      color: '#fff',
      fontSize: 12,
      display: 'flex',
      gap: 8,
      alignItems: 'center',
    }}>
      <input
        value={name}
        onChange={(e) => {
          callTool('brick_set_scene_name', { name: e.target.value });
        }}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: 4,
          color: '#fff',
          padding: '2px 6px',
          width: 100,
          fontSize: 12,
        }}
      />
      <span style={{ opacity: 0.7 }}>{count} bricks</span>
      <button
        onClick={async () => {
          if (!app) return;
          try {
            const result = await app.callServerTool({ name: 'brick_export_scene', arguments: { format: 'json' } });
            const text = result.content?.find((c: { type: string }) => c.type === 'text');
            if (text && 'text' in text) {
              navigator.clipboard.writeText(text.text as string).catch(console.error);
            }
          } catch (e) {
            console.error('Export failed:', e);
          }
        }}
        style={{
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: 4,
          color: '#fff',
          padding: '2px 8px',
          fontSize: 11,
        }}
      >
        Export
      </button>
      <button
        onClick={() => {
          callTool('brick_clear_scene', {});
        }}
        style={{
          background: 'rgba(255,80,80,0.3)',
          border: '1px solid rgba(255,80,80,0.5)',
          borderRadius: 4,
          color: '#fff',
          padding: '2px 8px',
          fontSize: 11,
        }}
      >
        Clear
      </button>
    </div>
  );
}
