import { useState, useEffect } from 'react';
import { Facebook, Instagram, Linkedin, Globe, Trash, SquarePen, MapPin, X as XIcon, Users, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import AddNewBrandDialog from '../Actions/AddNewBrandDialog';
import { deleteBrand, fetchAudienceSuggestions, fetchBrands } from '@/store/actions/brandIQ/myBrandActions';
import { useDispatch, useSelector } from 'react-redux';
import DeleteBrandDailog from '../Actions/DeleteBrandDailog';
import { motion } from 'framer-motion';
import { FADE_UP_ANIMATION_VARIANT } from '@/utils/ui/framerMotionVariants';
import { setBrandIQError } from '@/store/reducers/brandIQ/brandIQTabsSlice';
import AddNewBrand from '../Actions/AddNewBrand';
import BrandCardCarousel from './BrandCardCarousel';
import { globalToast } from '@/utils/globalToast';
import { Skeleton } from '@/components/ui/skeleton';
import { GA4Events } from '@/utils/ga4';
const BrandCard = ({ brand }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingBrand, setEditingBrand] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [regionNudgeDismissed, setRegionNudgeDismissed] = useState(false);
  const [bgColor, setBgColor] = useState('');
  const [audienceOpen, setAudienceOpen] = useState(false);
  const { userData } = useSelector((state) => state.socket);
  const { audienceSuggestions, audienceSuggestionsLoading } = useSelector((state) => state.brandIQTabs);
  const suggestions = audienceSuggestions[brand?.id] || null;
  const isAudienceLoading = audienceSuggestionsLoading[brand?.id] || false;
  const [isLoading, setIsLoading] = useState(true);
  const dispatch = useDispatch();

  const handleGenerateSuggestions = (force = false) => {
    if (!userData?.user_id || !brand?.id) return;
    dispatch(fetchAudienceSuggestions({ userId: userData.user_id, brandId: brand.id, force }));
    setAudienceOpen(true);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);
  function getDominantLogoColor(canvas) {
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const colorCounts = {};
    let maxCount = 0;
    let dominant = { r: 0, g: 0, b: 0 };

    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];

      // skip near-white or transparent pixels
      if (a < 128) continue;
      if (r > 240 && g > 240 && b > 240) continue;

      const key = `${r},${g},${b}`;
      colorCounts[key] = (colorCounts[key] || 0) + 1;

      if (colorCounts[key] > maxCount) {
        maxCount = colorCounts[key];
        dominant = { r, g, b };
      }
    }

    // fallback if only whitespace
    if (maxCount === 0) return { r: 200, g: 200, b: 200 };
    return dominant;
  }

  function adjustBackgroundColor({ r, g, b }) {
    // calculate perceived brightness
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

    const amount = 200; // amount to lighten/darken

    if (brightness < 128) {
      // dark color to lighter
      return `rgb(${Math.min(r + amount, 255)}, ${Math.min(g + amount, 255)}, ${Math.min(b + amount, 255)})`;
    } else {
      // light color to darker
      return `rgb(${Math.max(r - amount, 0)}, ${Math.max(g - amount, 0)}, ${Math.max(b - amount, 0)})`;
    }
  }

  useEffect(() => {
    if (!brand?.logoUrls?.[0]) return;

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = brand.logoUrls[0];

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const dominant = getDominantLogoColor(canvas);
      const adjustedBg = adjustBackgroundColor(dominant);
      setBgColor(adjustedBg);
    };
  }, [brand?.logoUrls]);

  const toggleReadMore = () => {
    setIsExpanded(!isExpanded);
  };

  const shouldTruncate = brand?.description?.length > 150;

  const displayText = isExpanded
    ? brand?.description
    : shouldTruncate
      ? `${brand?.description?.substring(0, 150)}...`
      : brand?.description;

  const handleEdit = () => {
    setEditingBrand(true);
  };

  const handleDelete = async () => {
    try {
      const payload = { userId: userData?.user_id, id: brand?.id };
      await dispatch(deleteBrand(payload)).unwrap();
      GA4Events.brandDeleted({ feature: 'brand_iq' });
      setIsDialogOpen(false);
      dispatch(fetchBrands(userData?.user_id));
      globalToast.success('Brand deleted successfully!');
    } catch (error) {
      console.error('Error deeting the brand', error);
      globalToast.error('Failed to delete the Brand');
    }
  };

  return (
    <motion.div
      id="tour_brand_individual_card"
      variants={FADE_UP_ANIMATION_VARIANT}
      initial="initial"
      whileInView="whileInView"
      viewport={{ once: true }}
      className="brand-iq-card rounded-10 relative overflow-hidden border border-[#DDD7CD] bg-[var(--ws-surface)] text-[#24211D] shadow-[0_4px_20px_-2px_rgba(80,70,58,0.06),0_2px_6px_-1px_rgba(80,70,58,0.03)] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white dark:shadow-none"
    >
      {/* Top Banner */}
      <div className="relative h-64 w-full 2xl:h-72">
        {Array.isArray(brand?.imageUrl) && brand?.imageUrl?.length > 0 ? (
          <>
            {isLoading && <Skeleton className="absolute inset-0 z-10 h-full w-full rounded-lg" />}

            <BrandCardCarousel
              from="BrandCard"
              images={brand?.imageUrl}
              onImagesLoaded={() => setIsLoading(false)}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            Please Upload Product Image
          </div>
        )}
      </div>

      {/* Content */}
      <div className="space-y-[15px] p-4">
        {/* Brand Header */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-2">
            <div
              className="image_container flex h-[34px] max-w-[34px] min-w-[34px] items-center justify-center overflow-hidden rounded-full bg-white p-1"
              style={{ backgroundColor: bgColor }}
            >
              {bgColor && brand?.logoUrls?.[0] && (
                <img
                  src={brand?.logoUrls[0]}
                  alt="brand logo"
                  className="rounded-full object-cover"
                />
              )}
            </div>
            <ShadcnTooltip label={'Brand Name'}>
              <span className="text-sm capitalize">{brand?.name}</span>
            </ShadcnTooltip>
          </div>
          <span className="text-10 text-gray-500 dark:text-[#8B8B8B]">
            {new Date(brand?.createdAt).toLocaleDateString('en-GB')}
          </span>
        </div>

        {/* Description */}
        <p className="max-h-[66px] overflow-y-auto text-xs leading-4 text-gray-600 2xl:text-xs dark:text-[#BEBEBE]">
          {displayText}
          {shouldTruncate && (
            <span className="ml-1 cursor-pointer text-gray-900 dark:text-white" onClick={toggleReadMore}>
              {isExpanded ? 'Read Less' : 'Read More'}
            </span>
          )}
        </p>

        {/* Target Audiences */}
        {Array.isArray(brand?.targetAudiences) && brand.targetAudiences.length > 0 && (
          <div className="scrollbar-thin flex max-h-[48px] flex-wrap gap-1.5 overflow-y-auto pr-1">
            {brand.targetAudiences.map((audience) => (
              <span
                key={audience}
                className="rounded-full border border-[#2BB8FC]/40 bg-[#2BB8FC]/10 px-2.5 py-0.5 text-[11px] text-[#1593c9] dark:text-[#7dd9f8]"
              >
                {audience}
              </span>
            ))}
          </div>
        )}

        {/* Region nudge for brands without a region set */}
        {/* {!brand?.region && !regionNudgeDismissed && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#11f5ed]/50 bg-[#6b72f8]/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-[#09cbfb]" />
              <span className="text-xs text-white">
                Add a{' '}
                <button
                  type="button"
                  className="text-[#11f5ed] underline hover:text-white"
                  onClick={handleEdit}
                >
                  primary audience region
                </button>{' '}
                to improve AI image quality.
              </span>
            </div>
            <button
              type="button"
              className="shrink-0 text-[#AFAFAF] hover:text-white"
              onClick={() => setRegionNudgeDismissed(true)}
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        )} */}

        {/* Audience Insights */}
        {/* <div className="rounded-xl border border-white/10 bg-white/5">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-xs text-[#AFAFAF] hover:text-white"
            onClick={() => setAudienceOpen((v) => !v)}
          >
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-[#6b72f8]" />
              <span className="font-medium text-white">Audience Insights</span>
            </div>
            {audienceOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {audienceOpen && (
            <div className="max-h-[220px] overflow-y-auto border-t border-white/10 px-3 pb-3 pt-2">
              {isAudienceLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-lg" />
                  ))}
                </div>
              ) : suggestions ? (
                <div className="space-y-2">
                  {suggestions.map((s, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-white/10 bg-[#0D0D0D]/50 p-2.5"
                    >
                      <p className="mb-1.5 text-xs font-medium leading-tight text-white">Audience Name: {s.audienceName}</p> 
                      <div className="mb-1.5 flex flex-wrap gap-1">
                        <span className="text-xs text-white">Interests:</span> {s.interests.map((interest, i) => (
                          <span
                            key={i}
                            className="rounded-full border border-[#6b72f8]/40 bg-[#6b72f8]/10 px-2 py-0.5 text-xs text-[#a5b4fc]"
                          >
                            {interest}
                          </span>
                        ))}
                      </div> 
                      <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-white">
                        <span>📍Geographic: {s.geographic}</span>
                        <span>AgeRange:  {s.ageRange}</span>
                        <span>Gender: {s.gender}</span>
                      </div> 
                      <p className="text-xs italic text-white">Reasoning: {s.reasoning}</p>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => handleGenerateSuggestions(true)}
                    className="mt-1 flex items-center gap-1 text-11 text-[#0ee3f3] hover:text-white"
                  >
                    <RefreshCw className="h-3 w-3" /> Regenerate
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-3 text-center">
                  <p className="text-xs text-[#AFAFAF]">
                    Get AI-powered insights on who your ideal audience is for this brand.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleGenerateSuggestions()}
                    className="rounded-full border border-[#6b72f8]/50 bg-[#6b72f8]/20 px-4 py-1.5 text-xs text-white transition-all hover:bg-[#6b72f8]/40"
                  >
                    Generate Insights
                  </button>
                </div>
              )}
            </div>
          )}
        </div> */}

        {/* Footer Icons */}
        <div className="mt-4 flex gap-[5px] 2xl:mt-[25px]">
          <ShadcnTooltip label={'Website'}>
            <a
              href={brand?.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="brand-iq-card-action icon_container flex h-6 w-6 items-center justify-center rounded-md border border-[#DDD7CD] bg-white p-1 hover:bg-[#F3EFE9] dark:border-0 dark:bg-[#2A2A2A]"
            >
              <Globe className="h-[14px] w-[14px] cursor-pointer text-gray-500 hover:text-black dark:text-white/60 dark:hover:text-white" />
            </a>
          </ShadcnTooltip>
          {brand?.facebookUrl && (
            <ShadcnTooltip label={'Facebook'}>
              <a
                href={brand?.facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="brand-iq-card-action icon_container flex h-6 w-6 items-center justify-center rounded-md border border-[#DDD7CD] bg-white p-1 hover:bg-[#F3EFE9] dark:border-0 dark:bg-[#2A2A2A]"
              >
                <Facebook className="h-[14px] w-[14px] cursor-pointer text-gray-500 hover:text-black dark:text-white/60 dark:hover:text-white" />
              </a>
            </ShadcnTooltip>
          )}
          {brand?.instagramUrl && (
            <ShadcnTooltip label={'Instagram'}>
              <a
                href={brand?.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="brand-iq-card-action icon_container flex h-6 w-6 items-center justify-center rounded-md border border-[#DDD7CD] bg-white p-1 hover:bg-[#F3EFE9] dark:border-0 dark:bg-[#2A2A2A]"
              >
                <Instagram className="h-[14px] w-[14px] cursor-pointer text-gray-500 hover:text-black dark:text-white/60 dark:hover:text-white" />
              </a>
            </ShadcnTooltip>
          )}
          {brand?.linkedinUrl && (
            <ShadcnTooltip label={'Linkedin'}>
              <a
                href={brand?.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="brand-iq-card-action icon_container flex h-6 w-6 items-center justify-center rounded-md border border-[#DDD7CD] bg-white p-1 hover:bg-[#F3EFE9] dark:border-0 dark:bg-[#2A2A2A]"
              >
                <Linkedin className="h-[14px] w-[14px] cursor-pointer text-gray-500 hover:text-black dark:text-white/60 dark:hover:text-white" />
              </a>
            </ShadcnTooltip>
          )}
        </div>
      </div>

      <div className="update_buttons_ absolute top-3 right-3 z-30 flex space-x-2">
        <ShadcnTooltip label={'Edit'}>
          <button
            id="tour_edit_brand"
            type="button"
            className="brand-iq-card-action icon_container backdrop-blur-80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[#DDD7CD] bg-white p-1 hover:border-[#C8C1B4] hover:text-green-600 dark:border-white/20 dark:bg-[#353535]/50 dark:hover:border-white/20 dark:hover:text-green-400"
            onClick={handleEdit}
          >
            <SquarePen className="h-[14px] w-[14px]" />
          </button>
        </ShadcnTooltip>
        <ShadcnTooltip label={'Delete'}>
          <button
            id="tour_delete_brand"
            type="button"
            className="brand-iq-card-action icon_container backdrop-blur-80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[#DDD7CD] bg-white p-1 hover:border-[#C8C1B4] hover:text-red-600 dark:border-white/20 dark:bg-[#353535]/50 dark:hover:border-white/20 dark:hover:text-red-400"
            onClick={() => {
              setIsDialogOpen(true);
              dispatch(setBrandIQError(null));
            }}
          >
            <Trash className="h-[14px] w-[14px]" />
          </button>
        </ShadcnTooltip>
      </div>
      {editingBrand && <AddNewBrand brandData={brand} setEditingBrand={setEditingBrand} />}
      {isDialogOpen && (
        <DeleteBrandDailog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onDelete={handleDelete}
        />
      )}
    </motion.div>
  );
};

export default BrandCard;
