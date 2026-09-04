import React from 'react';
import PHONE_FRAME from '@/assets/layouts/ad-factory/preview/phone_frame.png';
import { useSelector } from 'react-redux';
import { ThumbsUp, MessageSquare, Share2, EllipsisVertical } from 'lucide-react';
import googleAdsIcon from '@/assets/layouts/google-ads-icon.png';

const GoogleMobilePreview = ({ image, text, cta, ctaLink, brandName }) => {
  const { brandInfo } = useSelector((state) => state?.adFactoryNew);
  const name = brandName || brandInfo?.brandName || 'Brand';

  return (
    <div className="flex justify-center">
      <div
        className="relative aspect-[402/874] max-h-[680px] w-[clamp(300px,22vw,400px)] bg-[length:100%_100%] bg-no-repeat 2xl:max-h-[800px]"
        style={{ backgroundImage: `url(${PHONE_FRAME})` }}
      >
        <div className="absolute top-[8%] right-[6.5%] bottom-[5%] left-[6%] flex flex-col overflow-hidden rounded-[28px] bg-white text-[10px] text-gray-800">

          {/* Status bar spacer */}
          <div className="h-6 shrink-0 bg-white" />

          {/* Top bar: Google logo + icons */}
          <div className="flex shrink-0 items-center justify-between px-3 pb-1">
            <svg viewBox="0 0 74 24" className="h-5 w-auto">
              <path fill="#4285F4" d="M9.24 8.19v2.46h5.88c-.18 1.38-.64 2.39-1.34 3.1-.86.86-2.2 1.8-4.54 1.8-3.62 0-6.45-2.92-6.45-6.54s2.83-6.54 6.45-6.54c1.95 0 3.38.77 4.43 1.76L15.4 2.5C13.94 1.08 11.98 0 9.24 0 4.28 0 .11 4.04.11 9s4.17 9 9.13 9c2.68 0 4.7-.88 6.28-2.52 1.62-1.62 2.13-3.91 2.13-5.75 0-.57-.04-1.1-.13-1.54H9.24z"/>
              <path fill="#EA4335" d="M25 6.19c-3.21 0-5.83 2.44-5.83 5.81 0 3.34 2.62 5.81 5.83 5.81s5.83-2.46 5.83-5.81c0-3.37-2.62-5.81-5.83-5.81zm0 9.33c-1.76 0-3.28-1.45-3.28-3.52 0-2.09 1.52-3.52 3.28-3.52s3.28 1.43 3.28 3.52c0 2.07-1.52 3.52-3.28 3.52z"/>
              <path fill="#FBBC05" d="M53.58 7.49h-.09c-.57-.68-1.67-1.3-3.06-1.3C47.53 6.19 45 8.72 45 12c0 3.26 2.53 5.81 5.43 5.81 1.39 0 2.49-.62 3.06-1.32h.09v.81c0 2.22-1.19 3.41-3.1 3.41-1.56 0-2.53-1.12-2.93-2.07l-2.22.92c.64 1.54 2.33 3.43 5.15 3.43 2.99 0 5.52-1.76 5.52-6.05V6.49h-2.42v1zm-2.93 8.03c-1.76 0-3.1-1.5-3.1-3.52 0-2.05 1.34-3.52 3.1-3.52 1.74 0 3.1 1.5 3.1 3.54-.01 2.03-1.36 3.5-3.1 3.5z"/>
              <path fill="#4285F4" d="M38 6.19c-3.21 0-5.83 2.44-5.83 5.81 0 3.34 2.62 5.81 5.83 5.81s5.83-2.46 5.83-5.81c0-3.37-2.62-5.81-5.83-5.81zm0 9.33c-1.76 0-3.28-1.45-3.28-3.52 0-2.09 1.52-3.52 3.28-3.52s3.28 1.43 3.28 3.52c0 2.07-1.52 3.52-3.28 3.52z"/>
              <path fill="#34A853" d="M58 .24h2.51v17.57H58z"/>
              <path fill="#EA4335" d="M68.26 15.52l1.95 1.3c-.63.93-2.15 2.52-4.78 2.52-3.26 0-5.7-2.52-5.7-5.81 0-3.46 2.46-5.81 5.42-5.81 2.98 0 4.44 2.39 4.92 3.68l.26.65-7.69 3.18c.59 1.15 1.5 1.74 2.78 1.74 1.29 0 2.18-.64 2.84-1.45zm-6.03-2.07l5.14-2.13c-.28-.72-1.13-1.22-2.13-1.22-1.28 0-3.06 1.13-3.01 3.35z"/>
            </svg>
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-gray-500">
                <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              </div>
              <div className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-gray-500">
                <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-700 text-[8px] font-bold text-white">S</div>
            </div>
          </div>

          {/* Search bar */}
          <div className="mx-3 mb-2 shrink-0">
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 shadow-sm">
              <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0 text-gray-500 fill-current"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
              <span className="flex-1 text-[9px] text-gray-400">Search or type URL</span>
              <svg viewBox="0 0 24 24" className="h-3 w-3 text-blue-500 fill-current"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/></svg>
              <div className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-blue-500 border-r-red-500 border-b-yellow-500 border-l-green-500">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
              </div>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            {/* Weather widgets */}
            <div className="mx-3 mb-2 flex gap-2">
              <div className="flex flex-1 items-center justify-between rounded-xl border border-gray-100 bg-white p-2 shadow-sm">
                <div>
                  <div className="text-[8px] text-gray-500">New Delhi</div>
                  <div className="text-sm font-semibold">28°</div>
                  <div className="text-[7px] text-gray-400">Partly cloudy ☁ 10%</div>
                </div>
                <div className="text-xl">🌤</div>
              </div>
              <div className="flex flex-1 items-center justify-between rounded-xl border border-gray-100 bg-white p-2 shadow-sm">
                <div>
                  <div className="text-[8px] text-gray-500">Air quality · 49</div>
                  <div className="text-xs font-semibold">Good</div>
                </div>
                <div className="h-3 w-3 rounded-full bg-green-500" />
              </div>
            </div>

            {/* Sponsored ad card */}
            <div className="mx-3 mb-2 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              {/* Brand header */}
              <div className="flex items-start justify-between px-3 pt-3 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white shadow ring-1 ring-gray-100">
                    <img src={googleAdsIcon} alt="G" className="h-5 w-5 rounded-full object-contain" />
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-gray-900 leading-tight">
                      {name}
                    </div>
                    <div className="text-[8px] text-gray-400">Sponsored</div>
                  </div>
                </div>
                <EllipsisVertical className="h-4 w-4 text-gray-400" />
              </div>

              {/* Description */}
              <div className="px-3 pb-2 text-[11px] leading-relaxed text-gray-700">
                {text?.primaryText || text?.primary_text || text?.description}
              </div>

              {/* Full-width image — object-contain in a fixed-height box so the
                  whole creative shows at its real aspect ratio (matches the Meta
                  MobilePreview); object-cover was cropping the image. */}
              {image && (
                <div className="h-80 w-full bg-gray-100">
                  <img src={image} alt="Ad" className="h-full w-full object-contain" />
                </div>
              )}

              {/* URL + headline + CTA */}
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex flex-col">
                  <span className="text-[10px] text-gray-500 truncate">{ctaLink}</span>
                  <span className="text-[10px] font-semibold leading-tight text-gray-900">
                    {text?.headline}
                  </span>
                </div>
                <button className="shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-[9px] font-semibold text-gray-800 whitespace-nowrap">
                  {cta || 'Learn more'}
                </button>
              </div>

              {/* Like / Comment / Share */}
              {/* <div className="flex items-center justify-around border-t border-gray-100 px-2 py-2">
                {[
                  { icon: ThumbsUp, label: 'Like' },
                  { icon: MessageSquare, label: 'Comment' },
                  { icon: Share2, label: 'Share' },
                ].map(({ icon: Icon, label }) => (
                  <button key={label} className="flex items-center gap-1 text-[8px] text-gray-500">
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                ))}
              </div> */}
            </div>
          </div>

          {/* Bottom nav */}
          <div className="flex shrink-0 items-center justify-around border-t border-gray-100 bg-white py-2">
            {[
              { label: 'Home', active: true, path: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z' },
              { label: 'Tabs', path: 'M4 6h18v2H4zm0 5h18v2H4zm0 5h18v2H4z' },
              { label: 'Notifications', path: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z' },
            ].map(({ label, active, path }) => (
              <div key={label} className="flex flex-col items-center gap-0.5">
                <svg viewBox="0 0 24 24" className={`h-4 w-4 fill-current ${active ? 'text-blue-600' : 'text-gray-400'}`}>
                  <path d={path} />
                </svg>
                <span className={`text-[7px] ${active ? 'text-blue-600' : 'text-gray-400'}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GoogleMobilePreview;
