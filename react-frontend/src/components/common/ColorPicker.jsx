import React from 'react';
import { SketchPicker } from 'react-color';

const SYSTEM_COLORS = [
  '#FFFFFF',
  '#FF5757',
  '#FF8A00',
  '#FFD600',
  '#06D6A0',
  '#1B9CFC',
  '#82589F',
  '#000000',
  '#F43F5E',
  '#EC4899',
  '#D946EF',
  '#8B5CF6',
  '#6366F1',
  '#3B82F6',
  '#14B8A6',
  '#84CC16',
];

export default function ColorPicker({ color, onChange }) {
  const handleChange = (colorResult) => {
    // SketchPicker returns { hex, rgb, hsl, ... }
    if (colorResult && colorResult.hex) {
      onChange(colorResult.hex);
    }
  };

  return (
    <div className="color-picker-wrapper" onMouseDown={(e) => e.stopPropagation()}>
      <style>{`
        .color-picker-wrapper .sketch-picker {
          background: #1e1e1e !important;
          border: 1px solid #3f3f46 !important;
          box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5) !important;
          border-radius: 12px !important;
          padding: 12px !important;
        }
        
        .color-picker-wrapper .sketch-picker input {
          background: #27272a !important;
          border: 1px solid #3f3f46 !important;
          color: #fff !important;
          box-shadow: none !important;
        }
        
        .color-picker-wrapper .sketch-picker label {
          color: #a1a1aa !important;
        }
        
        .color-picker-wrapper .sketch-picker .flexbox-fix:last-child > div > div > div > div {
          background: transparent !important;
        }
        
        /* Active color display */
        .color-picker-wrapper .sketch-picker > div:first-child > div:first-child {
          border-radius: 8px !important;
        }
        
        /* Saturation picker */
        .color-picker-wrapper .saturation-white,
        .color-picker-wrapper .saturation-black {
          border-radius: 8px !important;
        }
        
        /* Hue slider */
        .color-picker-wrapper .hue-horizontal {
          border-radius: 6px !important;
        }
        
        /* Alpha slider */
        .color-picker-wrapper .alpha-horizontal {
          border-radius: 6px !important;
        }
        
        /* Preset colors */
        .color-picker-wrapper .sketch-picker .flexbox-fix:last-child {
          border-top: 1px solid #3f3f46 !important;
          padding-top: 12px !important;
        }
      `}</style>
      <SketchPicker
        color={color || '#FFFFFF'}
        onChange={handleChange}
        disableAlpha={false}
        presetColors={SYSTEM_COLORS}
        width="256px"
      />
    </div>
  );
}
