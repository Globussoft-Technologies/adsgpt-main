/**
 * Tuning harness for `MosaicLoader` — `/mosaic-preview`.
 *
 * The loader only appears while a real render is in flight, which means the
 * only way to look at it was to pay for a storyboard run and then have twenty
 * seconds to judge it before it went away. This shows it standing still, in the
 * three boxes it actually occupies, with the knobs live.
 *
 * The sliders are the point. Blur, density and speed are the three numbers that
 * decide whether this reads as "an image is being composed" or as "a broken
 * gradient", and picking them by editing a constant and waiting for a rebuild
 * is how you end up settling for the first value that was not obviously wrong.
 * Whatever looks right here, paste back into the constants at the top of
 * `MosaicLoader.jsx` — every slider starts at the shipped value.
 *
 * Not linked from anywhere in the product, and not gated either: it renders
 * nothing but the loader and reads no data, so there is nothing here to
 * protect. It costs one route.
 */

import { useState } from 'react';
import MosaicLoader from './MosaicLoader';

const SURF = '#1B1B21';
const LINE = 'rgba(255,255,255,0.09)';

function Knob({ label, value, min, max, step = 1, onChange }) {
  return (
    <label className="flex items-center gap-3 text-[12px] text-white/60">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-40 accent-[#15DCFF]"
      />
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-white/80 tabular-nums">
        {value}
      </span>
    </label>
  );
}

/** One of the boxes the loader really sits in, at its real size. */
function Slot({ title, width, height, children }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10.5px] font-semibold tracking-[0.12em] text-white/35 uppercase">
        {title}
      </span>
      <div
        className="overflow-hidden rounded-lg border"
        style={{ width, height, background: 'rgba(255,255,255,0.03)', borderColor: LINE }}
      >
        {children}
      </div>
    </div>
  );
}

export default function MosaicPreview() {
  const [blur, setBlur] = useState(4);
  const [cols, setCols] = useState(7);
  const [rows, setRows] = useState(12);
  const [speed, setSpeed] = useState(1);

  const props = { blur, cols, rows, speed };

  return (
    <div
      className="dark min-h-screen w-full p-8 text-white"
      style={{ background: '#0f0f0f', fontFamily: "'Public Sans', sans-serif" }}
    >
      <h1 className="text-lg font-bold">Mosaic loader</h1>
      <p className="mt-1 max-w-xl text-[13px] text-white/45">
        The three boxes this appears in, at the sizes it appears at. Sliders start at the
        shipped values — copy whatever looks right back into the constants at the top of{' '}
        <code className="text-white/70">MosaicLoader.jsx</code>.
      </p>

      <div
        className="mt-5 flex w-fit flex-col gap-2.5 rounded-xl border p-4"
        style={{ background: SURF, borderColor: LINE }}
      >
        <Knob label="Blur" value={blur} min={0} max={20} onChange={setBlur} />
        <Knob label="Columns" value={cols} min={3} max={20} onChange={setCols} />
        <Knob label="Rows" value={rows} min={4} max={32} onChange={setRows} />
        <Knob label="Speed" value={speed} min={0.3} max={3} step={0.1} onChange={setSpeed} />
      </div>

      <div className="mt-8 flex flex-wrap items-end gap-8">
        {/* The pair on a concept card, side by side, which is the case where two
            loaders must not look like one image repeated. */}
        <div className="flex flex-col gap-2">
          <span className="text-[10.5px] font-semibold tracking-[0.12em] text-white/35 uppercase">
            Concept card · both frames
          </span>
          <div
            className="flex gap-2 rounded-2xl border p-3"
            style={{ background: SURF, borderColor: LINE }}
          >
            {[0, 1].map((i) => (
              <div
                key={i}
                className="overflow-hidden rounded-lg"
                style={{ width: 132, height: 235, background: 'rgba(255,255,255,0.03)' }}
              >
                <MosaicLoader offset={i * 7} {...props} />
              </div>
            ))}
          </div>
        </div>

        <Slot title="Clip screen · 9:16" width={270} height={480}>
          <MosaicLoader {...props} />
        </Slot>

        <Slot title="Small · worst case" width={96} height={170}>
          <MosaicLoader offset={3} {...props} />
        </Slot>
      </div>

      {/* On white, because the panel greys are tuned against near-black and it
          is worth seeing how much of the effect survives if this is ever used
          on a light surface. */}
      <div className="mt-10 flex w-fit flex-wrap items-end gap-8 rounded-xl bg-[#F7F4EE] p-6">
        <Slot title="On light" width={132} height={235}>
          <MosaicLoader offset={5} {...props} />
        </Slot>
      </div>
    </div>
  );
}
