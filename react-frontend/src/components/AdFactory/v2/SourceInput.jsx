import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Globe, Sparkles } from 'lucide-react';
import { PrimaryBtn } from './Panel';
import { LABEL } from './_tokens';

// ----------------------------------------------------------------------------
// SourceInput — screen 1 of Quick setup, and the entire front door.
//
// Composed from the Landing Page Analyzer's hero, which is the reference for
// this kind of "paste a URL, we do the rest" moment: ambient glow, accent
// badge, gradient headline, and the URL field as a rounded pill with the
// GradBtn living INSIDE it. Same `_atoms` (GradBtn) rather than a private
// button, so this stays in step with that surface automatically.
//
// One question: what are you advertising? A URL, or a brand you've saved.
// v1 asks for a campaign name, brand description, voice, do's, don'ts, palette,
// objective, audience and an asset upload before it generates anything — all
// nine are inferred from this.
// ----------------------------------------------------------------------------

const looksLikeUrl = (value) => {
  const v = String(value || '').trim();
  if (!v || /\s/.test(v)) return false;
  if (/[^\p{ASCII}]/u.test(v)) return false;
  const candidate = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const host = new URL(candidate).hostname;
    if (!host.includes('.')) return false;
    return /^[a-z]{2,}$/i.test(host.split('.').pop());
  } catch {
    return false;
  }
};

export default function SourceInput({ onSubmitUrl, onPickBrand, busy = false }) {
  const reduce = useReducedMotion();
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);

  // `fetchBrands` (brandIQTabs/fetchBrands) writes to state.brandIQTabs.myBrands,
  // and AdFactoryPage already dispatches it on mount — so the data is there.
  //
  // Two earlier cuts still rendered nothing. First it read
  // `state.myBrand?.brands || state.brandIQ?.brands` — neither slice exists.
  // Then it filtered on `b.brandName`, but a brand from /brand/get-lists is
  // `{ id, name, description, logoUrls }` (see BrandSelect / TopHeader), so
  // every row was discarded and the block hid itself again. Both failures look
  // identical from the outside: "no option to select existing brands", no error.
  const myBrands = useSelector((state) => state.brandIQTabs?.myBrands);

  const savedBrands = useMemo(() => {
    if (!Array.isArray(myBrands)) return [];
    return myBrands.filter((b) => b?.name || b?.brandName).slice(0, 6);
  }, [myBrands]);

  const valid = looksLikeUrl(url);
  const invalid = touched && url.trim().length > 0 && !valid;

  const submit = () => {
    setTouched(true);
    if (!valid || busy) return;
    onSubmitUrl?.(url.trim());
  };

  return (
    // min-h + shrink-0 rather than flex-1: this sits in an overflow-y-auto
    // flex column, where a flex-1 child has flex-basis 0 and is allowed to
    // shrink below its own content — which clipped the headline off the top as
    // soon as the briefs list appeared underneath. A minimum height keeps the
    // empty first-run screen feeling centred without ever squeezing.
    <div className="relative flex min-h-[58vh] w-full shrink-0 flex-col items-center justify-center px-4 py-10 text-center">
      {/* No glow of its own: the page mounts AdFactoryBgEffect, the same
          backdrop Full control uses. A second, differently-coloured glow layered
          under this hero fought with it and made Quick setup look like a
          different product. */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex w-full flex-col items-center"
      >
        {/* An eyebrow, not a badge. A tinted pill with a letterspaced caps
            label inside it is two treatments doing one job. */}
        <span className="inline-flex items-center gap-2 text-13 font-medium text-[#4654D4] dark:text-[#15DCFF]">
          <Sparkles className="h-3.5 w-3.5" />
          Quick setup
        </span>

        {/* 15ch, not max-w-3xl. The measure IS the design here: it forces the
            three-line stack that makes the gradient line land as its own
            statement. On one wide line the same words read as a caption. */}
        <h2 className="mt-5 max-w-[15ch] text-4xl leading-[1.06] font-semibold tracking-[-0.028em] text-balance text-[var(--ws-text-primary)] 2xl:text-5xl dark:text-[#F4F4F5]">
          Turn any page into a{' '}
          <span className="text-[#5867EB] dark:text-[#15DCFF]">running campaign.</span>
        </h2>

        <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-balance text-[var(--ws-text-secondary)] dark:text-[#AFAFAF]">
          Paste a product or landing page. We read your brand, audience and objective
          from it, then build the ads. About 30 seconds.
        </p>

        {/* A filled well, darker than the page — the same treatment every
            control on this surface gets (see briefFields INPUT). */}
        <div
          className={`mt-8 flex w-full max-w-xl items-center gap-2.5 rounded-xl border bg-[var(--ws-surface)] p-1.5 pl-3.5 shadow-[var(--ws-shadow-sm)] transition-colors focus-within:border-[#5867EB] dark:bg-[#171717] dark:shadow-none dark:focus-within:border-[#15DCFF] ${
            invalid
              ? 'border-red-400/60 dark:border-red-500/40'
              : 'border-[var(--ws-border)] dark:border-[#2A2A2A]'
          }`}
        >
          <Globe className="h-4.5 w-4.5 shrink-0 text-[var(--ws-text-muted)] dark:text-[#777777]" />
          <input
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="yourbrand.com/product"
            className="min-w-0 flex-1 bg-transparent py-2 text-base text-[var(--ws-text-primary)] outline-none placeholder:text-[var(--ws-text-muted)] dark:text-[#F4F4F5] dark:placeholder:text-[#777777]"
          />
          <PrimaryBtn
            icon={ArrowRight}
            busy={busy}
            onClick={submit}
            disabled={!valid}
            className="shrink-0"
          >
            Continue
          </PrimaryBtn>
        </div>

        {invalid && (
          <p className="mt-2.5 text-13 text-red-600 dark:text-red-400">
            That doesn't look like a web address — try yourbrand.com/product
          </p>
        )}

        {savedBrands.length > 0 && (
          <div className="mt-10 flex w-full max-w-xl flex-col items-center gap-3">
            <span className={LABEL}>or start from a saved brand</span>
            <div className="flex flex-wrap justify-center gap-2">
              {savedBrands.map((brand) => (
                <button
                  key={brand.id || brand._id || brand.name}
                  type="button"
                  disabled={busy}
                  onClick={() => onPickBrand?.(brand.id || brand._id)}
                  className="inline-flex items-center gap-2.5 rounded-lg border border-[var(--ws-border)] bg-[var(--ws-surface)] py-1.5 pr-3.5 pl-1.5 text-13 font-medium text-[var(--ws-text-primary)] shadow-[var(--ws-shadow-sm)] transition-colors hover:border-[var(--ws-border-strong)] disabled:opacity-50 dark:border-[#2A2A2A] dark:bg-[#171717] dark:text-[#F4F4F5] dark:shadow-none dark:hover:border-[#3A3A3A]"
                >
                  <BrandMark brand={brand} />
                  <span className="max-w-45 truncate">{brand.name || brand.brandName}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function BrandMark({ brand }) {
  const [broken, setBroken] = useState(false);
  const logo = brand?.logoUrls?.[0] || brand?.logoUrl;

  if (logo && !broken) {
    return (
      <img
        src={logo}
        alt=""
        className="size-7 rounded-md border border-[var(--ws-border)] bg-[var(--ws-surface)] object-contain dark:border-[#2A2A2A] dark:bg-[#202020]"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="grid size-7 place-items-center rounded-md border border-[var(--ws-border)] bg-[var(--ws-surface-control)] text-13 font-semibold text-[var(--ws-text-secondary)] dark:border-[#2A2A2A] dark:bg-[#202020] dark:text-[#AFAFAF]">
      {String(brand?.name || brand?.brandName || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}
