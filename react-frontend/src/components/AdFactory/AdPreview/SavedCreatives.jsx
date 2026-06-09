import { Pencil, Trash2 } from 'lucide-react';
import NOT_FOUND from '@/assets/layouts/ad-factory/preview/not_found.png';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import {
  deleteAdFactoryAdcreative,
  fetchCampaignById,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { setEnableId } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';

const SavedCreatives = ({ onOpenCreative, onDeleteCreative }) => {
  const { postnodecreatives } = useSelector((state) => state.adFactoryNew);
  const { userData } = useSelector((state) => state?.socket);
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');
  const dispatch = useDispatch();
  // {
  //   console.log('creative', postnodecreatives);
  // }

  const handleDelete = async (e, creativeId) => {
    e.stopPropagation();

    if (onDeleteCreative) {
      onDeleteCreative(creativeId);
    }

    const result = await dispatch(
      deleteAdFactoryAdcreative({
        campaignId,
        creativeId,
      })
    );
    if (deleteAdFactoryAdcreative.fulfilled.match(result)) {
      const campaignPayload = {
        campaignId,
        userId: userData?.user_id,
      };
      dispatch(fetchCampaignById(campaignPayload));
    }
  };
  if (!postnodecreatives?.length) {
    return (
      <div className="-mt-16 flex w-full flex-col items-center justify-center text-gray-500 dark:text-white/60">
        <img src={NOT_FOUND} alt="" className="w-96 object-cover opacity-80" />
        <p className="-mt-4 text-lg">No saved creatives yet</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto p-6 pt-20 md:pt-8 lg:px-8 lg:py-10">
      <h2 className="mb-6 text-xl font-semibold text-gray-900 dark:text-white">Saved Creatives</h2>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 2xl:gap-5">
        {postnodecreatives.map((creative) => (
          <div
            key={creative.creativeId}
            className="cursor-pointer overflow-hidden rounded-2xl border border-black/10 dark:border-white/20 bg-gray-50 dark:bg-[#141414] transition-all duration-300"
            onClick={() => onOpenCreative(creative.creativeId, true)}
          >
            {/* IMAGE */}
            <div className="group relative h-45 w-full cursor-pointer overflow-hidden rounded-t-2xl bg-gray-100 dark:bg-black/20 2xl:h-60">
              <img
                src={creative.imageUrl}
                alt="img"
                className="h-full w-full object-cover transition-all duration-500 group-hover:scale-105 group-hover:opacity-80"
              />

              {/* Hover actions */}
              <div className="absolute top-3 right-3 z-10 flex gap-2 opacity-100 transition-all duration-200 group-hover:opacity-100 md:opacity-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCreative(creative.creativeId, true);
                  }}
                  className="rounded-md bg-black/60 p-2 text-white backdrop-blur hover:bg-black/80"
                >
                  <Pencil className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // onDeleteCreative(creative.creativeId);
                    handleDelete(e, creative.creativeId);
                  }}
                  className="rounded-md bg-black/60 p-2 text-red-400 backdrop-blur hover:bg-black/80"
                >
                  <Trash2 className="h-3.5 w-3.5 2xl:h-4 2xl:w-4" />
                </button>
              </div>
            </div>

            {/* FOOTER */}
            <div className="flex flex-col gap-2 bg-white dark:bg-[#0f0f0f] p-3 2xl:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {/* Placeholder logo */}
                  <div className="flex h-5.5 w-5.5 items-center justify-center rounded-full bg-gray-50 dark:bg-[#2a2a2a] text-xs font-bold text-black 2xl:h-8 2xl:w-8 2xl:text-base">
                    ⚡
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white 2xl:text-lg">
                    {creative.headline || 'AdsGPT'}
                  </span>
                </div>

                <span className="text-[11px] text-gray-500 dark:text-white/50 2xl:text-xs">
                  {new Date().toLocaleDateString()}
                </span>
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-white 2xl:text-lg">
                {creative.headline || 'Ad Headline'}
              </span>
              <p className="mt-1 line-clamp-3 px-1 text-[11px] text-gray-500 dark:text-white/70 2xl:text-sm">
                {creative.message ||
                  'Create scroll-stopping ads in seconds with AI that understands your brand and audience.'}
              </p>

              {/* Description */}
              {/* <p className="mt-1 line-clamp-3 px-1 text-[11px] text-white/70 2xl:text-sm">
                {creative.description ||
                  'Create scroll-stopping ads in seconds with AI that understands your brand and audience.'}
              </p> */}

              {/* CTA BUTTON */}
              <a
                href={creative.linkUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                // onClick={() => onOpenCreative(creative.id)}
                className="mt-1 w-fit rounded-full bg-gray-900 dark:bg-white px-4 py-1.5 text-[11px] font-medium text-white dark:text-[#0f0f0f] transition hover:bg-gray-800 dark:hover:bg-white/80 2xl:mt-2 2xl:text-sm"
              >
                {creative.callToAction.replace(/_/g, ' ') || 'Read More'}
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SavedCreatives;
