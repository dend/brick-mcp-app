import { DEFAULT_COLORS } from '../constants';

interface ColorPickerProps {
  selectedColor: string;
  onColorChange: (hex: string) => void;
  visible: boolean;
}

export default function ColorPicker({ selectedColor, onColorChange, visible }: ColorPickerProps) {
  if (!visible) return null;

  return (
    <div style={{
      position: 'absolute',
      right: 170,
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 28px)',
      gap: 4,
      background: 'rgba(0,0,0,0.7)',
      borderRadius: 8,
      padding: 6,
      zIndex: 10,
    }}>
      {DEFAULT_COLORS.map(({ name, hex }) => (
        <button
          key={hex}
          onClick={() => onColorChange(hex)}
          title={name}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: hex,
            border: selectedColor === hex ? '3px solid #fff' : '2px solid rgba(255,255,255,0.3)',
            cursor: 'pointer',
            transition: 'border 0.15s',
          }}
        />
      ))}
    </div>
  );
}
