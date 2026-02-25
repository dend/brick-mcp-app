import type { BrickType } from '../types';

interface BrickSelectorProps {
  catalog: BrickType[];
  selectedType: BrickType;
  onSelect: (bt: BrickType) => void;
  visible: boolean;
}

export default function BrickSelector({ catalog, selectedType, onSelect, visible }: BrickSelectorProps) {
  if (!visible || catalog.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      right: 8,
      top: 60,
      width: 150,
      maxHeight: 'calc(100% - 120px)',
      overflowY: 'auto',
      background: 'rgba(0,0,0,0.7)',
      borderRadius: 8,
      padding: 8,
      zIndex: 10,
      color: '#fff',
      fontSize: 12,
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4, opacity: 0.6, textTransform: 'uppercase', fontSize: 10 }}>
        Parts
      </div>
      {catalog.map((bt) => (
        <button
          key={bt.id}
          onClick={() => onSelect(bt)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '4px 6px',
            marginBottom: 2,
            background: selectedType.id === bt.id ? 'rgba(255,255,255,0.2)' : 'transparent',
            border: selectedType.id === bt.id ? '1px solid rgba(255,255,255,0.4)' : '1px solid transparent',
            borderRadius: 4,
            color: '#fff',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {bt.name}
        </button>
      ))}
    </div>
  );
}
