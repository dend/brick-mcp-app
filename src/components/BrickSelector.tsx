import { useState } from 'react';
import type { BrickType } from '../types';

interface BrickSelectorProps {
  catalog: BrickType[];
  selectedType: BrickType;
  onSelect: (bt: BrickType) => void;
  onFetchById: (typeId: string) => Promise<BrickType | null>;
  visible: boolean;
}

export default function BrickSelector({ catalog, selectedType, onSelect, onFetchById, visible }: BrickSelectorProps) {
  const [partIdInput, setPartIdInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = partIdInput.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    const def = await onFetchById(id);
    setLoading(false);
    if (def) {
      onSelect(def);
      setPartIdInput('');
    } else {
      setError(`Unknown part: ${id}`);
    }
  };

  return (
    <div style={{
      position: 'absolute',
      right: 8,
      top: 60,
      width: 180,
      maxHeight: 'calc(100% - 120px)',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(0,0,0,0.7)',
      borderRadius: 8,
      padding: 8,
      zIndex: 10,
      color: '#fff',
      fontSize: 12,
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: 6, opacity: 0.6, textTransform: 'uppercase', fontSize: 10 }}>
        Parts ({catalog.length})
      </div>

      <form onSubmit={handleFetch} style={{ marginBottom: 6 }}>
        <input
          type="text"
          value={partIdInput}
          onChange={e => { setPartIdInput(e.target.value); setError(null); }}
          placeholder="LDraw ID (e.g. 11215)"
          disabled={loading}
          style={{
            width: '100%',
            padding: '4px 6px',
            background: 'rgba(255,255,255,0.1)',
            border: error ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            color: '#fff',
            fontSize: 11,
            fontFamily: 'monospace',
          }}
        />
        {error && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>{error}</div>}
      </form>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {catalog.map((bt) => (
          <button
            key={bt.id}
            onClick={() => onSelect(bt)}
            title={`${bt.id} · ${bt.studsX}×${bt.studsZ}×${bt.heightUnits}`}
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
              fontSize: 11,
              cursor: 'pointer',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {bt.name}
          </button>
        ))}
        {catalog.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 11, textAlign: 'center', padding: 8 }}>
            Loading parts…
          </div>
        )}
      </div>
    </div>
  );
}
