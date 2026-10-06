import React from 'react';
import { Lock } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { setActivePage } from '@/store/reducers/adStudio/adVideoNewSlice';
import StudioToolStage from '@/components/AdStudio/StudioToolStage';

const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;
const s3 = (u) => (u?.startsWith('http') ? u : import.meta.env.VITE_S3_BASE_URL + u);

// Same chip as AdVideoCard. `bg-linear-to-r` keeps the gradient in light mode
// (App.css blanks `rounded-full bg-gradient-to-*`).
const Chip = ({ children }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-linear-to-r from-[#15DCFF] to-[#6b72f8] px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase">
    {children}
  </span>
);

/**
 * The V2 Ad Video tools, as the tool stage. `cards` is still the JSON in
 * AdVideoHomeNew.jsx. Open/lock/coming-soon logic is the same as AdVideoCard's
 * (plan 8 → signup page, comingSoon → disabled). V1 has its own home
 * (components/AdStudio/v1/AdVideoHomeV1.jsx).
 */
export default function AdVideoModuleCards({ cards = [] }) {
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
  const hasPlan8 = Object.keys(userData?.userSubscriptionType || {}).includes('8');

  const tools = cards.map((card) => {
    const isLocked = card.premium && hasPlan8;
    return {
      key: card.type,
      tourId: `tour_ad-video-card_${card.type}`,
      title: card.title,
      desc: card.desc,
      img: s3(card.img),
      gif: s3(card.gif),
      disabled: !!card.comingSoon,
      badge: card.comingSoon ? (
        <Chip>Coming Soon</Chip>
      ) : isLocked ? (
        <Chip>
          <Lock className="h-2.5 w-2.5" />
          Premium
        </Chip>
      ) : null,
      onOpen: () => {
        if (card.comingSoon) return;
        if (isLocked) {
          window.open(SIGNUP_URL, '_blank', 'noopener,noreferrer');
          return;
        }
        dispatch(setActivePage(card.type));
      },
    };
  });
  return <StudioToolStage label="Video ad tools" kindLabel="Ad video" tools={tools} />;
}
