import { forwardRef } from 'react';

const ThreeCanvas = forwardRef<HTMLDivElement>(function ThreeCanvas(_, ref) {
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
      }}
    />
  );
});

export default ThreeCanvas;
