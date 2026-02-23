import type { InteractionMode } from '../types';
import { INTERACTION_MODES } from '../constants';

const MODE_ICONS: Record<InteractionMode, string> = {
  look: '👁',
  place: '🧱',
  select: '👆',
  move: '✋',
  rotate: '🔄',
  delete: '🗑',
  paint: '🎨',
};

interface ToolbarProps {
  mode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
}

export default function Toolbar({ mode, onModeChange }: ToolbarProps) {
  return (
    <div style={{
      position: 'absolute',
      left: 8,
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      background: 'rgba(0,0,0,0.7)',
      borderRadius: 8,
      padding: 4,
      zIndex: 10,
    }}>
      {INTERACTION_MODES.map(({ mode: m, label, shortcut }) => (
        <button
          key={m}
          onClick={() => onModeChange(m)}
          title={`${label} (${shortcut})`}
          style={{
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: mode === m ? 'rgba(255,255,255,0.25)' : 'transparent',
            border: mode === m ? '2px solid rgba(255,255,255,0.6)' : '2px solid transparent',
            borderRadius: 6,
            color: '#fff',
            fontSize: 20,
            transition: 'all 0.15s',
          }}
        >
          {MODE_ICONS[m]}
        </button>
      ))}
    </div>
  );
}
