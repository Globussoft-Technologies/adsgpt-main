import { setActivePage } from '@/store/reducers/adStudio/adVideoNewSlice';
import { ChevronRight, Lock } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';

const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;

const AdVideoCard = ({ title, desc, img, gif, type, comingSoon, premium }) => {
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
  const imgUrl = import.meta.env.VITE_S3_BASE_URL + img;
  const gifUrl = import.meta.env.VITE_S3_BASE_URL + gif;

  // Plan "8" is the free plan; premium-only features are locked for these users.
  const hasPlan8 = Object.keys(userData?.userSubscriptionType || {}).includes('8');
  const isLocked = premium && hasPlan8;

  const handleClick = () => {
    if (comingSoon) return;
    if (isLocked) {
      window.open(SIGNUP_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    dispatch(setActivePage(type));
  };

  return (
    <div
      id={`tour_ad-video-card_${type}`}
      className={`group relative h-full min-h-[180px] overflow-hidden rounded-2xl 2xl:rounded-4xl ${comingSoon ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      onClick={handleClick}
    >
      {/* image */}
      <img
        src={imgUrl}
        alt={title}
        className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:opacity-0"
      />

      {/* GIF */}
      <img
        src={gifUrl}
        alt={`${title}-preview`}
        // className={`absolute inset-0 ${type === 'b-roll' ? 'h-[180%]' : 'h-full'} w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
         className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      {/* overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent group-hover:from-black/70 group-hover:via-black/20 group-hover:to-transparent" />

      {/* Coming Soon badge */}
      {comingSoon && (
        <div className="absolute top-3 right-3 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase shadow-md 2xl:text-xs">
          Coming Soon
        </div>
      )}

      {/* Premium / locked badge */}
      {!comingSoon && isLocked && (
        <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase shadow-md 2xl:text-xs">
          <Lock className="h-3 w-3" />
          Premium
        </div>
      )}

      {/* content */}
      <div className="absolute right-0 sm:right-2 bottom-4 left-2 sm:left-4 flex items-end justify-between text-white transition duration-300 group-hover:-translate-y-2">
        <div>
          <h3
            className={`text-base sm:text-lg font-semibold tracking-wide 2xl:text-2xl ${comingSoon ? 'text-white/60' : 'text-white'}`}
          >
            {title}
          </h3>
          <p className="text-[10px] sm:text-xs 2xl:text-sm text-white/90">{desc}</p>
        </div>

        {!comingSoon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full">
            <ChevronRight className="h-6.5 w-6.5 text-white 2xl:h-8 2xl:w-8" />
          </div>
        )}
      </div>
    </div>
  );
};

export default AdVideoCard;
