import React from 'react';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import { useSelector } from 'react-redux';
import ImageAdCard from './Image/ImageAdCard';
import VideoAdCard from './Video/VideoAdCard';
import TextAdCard from './Text/TextAdCard';
import AdCardSkeleton from './AdCardSkeleton';

const AdCardContainer = ({ adsData = [], scrollLoading, hasMore }) => {
  const isAddieChatVisible = useSelector((state) => state.addie?.addieChatVisibility);
  const loading = useSelector((state) => state.addie?.loading);

  const transformedAds =
    adsData?.map((ad, index) => {
      // Validate and set default values for required properties
      const validatedAd = {
        id: ad?.id || index,
        image: ad?.postImage || ad?.thumbnail_url || '',
        description: ad?.description || ad?.newsfeedDescription || '',
        popularity: typeof ad?.popularityIndex === 'number' && ad?.popularityIndex,
        network: ad?.network || 'unknown',
        postOwner: ad?.postOwner || 'Unknown',
        adTitle: ad?.adTitle || 'No title',
        postImage: ad?.postImage || '',
        adUrl: ad?.adUrl || '#',
        open_in_pas: ad?.open_in_pas || '#',
        newsfeedDescription: ad?.newsfeedDescription || '',
        adType: ad?.adType || 'IMAGE',
        othermedia: Array.isArray(ad?.othermedia) ? ad?.othermedia : [],
        postOwnerImage: ad?.postOwnerImage || '',
        thumbnail_url: ad?.thumbnail_url,
      };

      return validatedAd;
    }) || [];

  // Skeleton count based on layout - show 10 skeletons during scroll loading
  const skeletonCount = 10;

  // Function to render ads based on their type
  const renderAdCards = (ads) => {
    return ads?.map((ad, index) => {
      const actualIndex = transformedAds?.indexOf(ad) ?? index;
      const key = `${ad?.id}-${ad?.network}-${actualIndex}`;

      if (ad?.adType === 'CAROUSAL_AD' || ad?.adType === 'IMAGE') {
        return (
          <ImageAdCard
            key={key}
            image={ad?.image}
            description={ad?.description}
            popularity={ad?.popularity}
            network={ad?.network}
            postOwner={ad?.postOwner}
            adTitle={ad?.adTitle}
            adUrl={ad?.adUrl}
            adType={ad?.adType}
            othermedia={ad?.othermedia}
            postImage={ad?.postImage}
            postOwnerImage={ad?.postOwnerImage}
            thumbnail_url={ad?.thumbnail_url}
            ad={ad}
          />
        );
      } else if (ad?.adType === 'carousalVideoAd' || ad?.adType === 'VIDEO') {
        return (
          <VideoAdCard
            key={key}
            description={ad?.description}
            popularity={ad?.popularity}
            network={ad?.network}
            postOwner={ad?.postOwner}
            adTitle={ad?.adTitle}
            adUrl={ad?.adUrl}
            adType={ad?.adType}
            othermedia={ad?.othermedia}
            postImage={ad?.postImage}
            postOwnerImage={ad?.postOwnerImage}
            thumbnail_url={ad?.thumbnail_url}
          />
        );
      } else if (ad?.adType === 'TEXT') {
        return <TextAdCard key={key} {...ad} />;
      }

      return null;
    });
  };

  // Simple No Ads Found Component
  const NoAdsFound = () => (
    <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800/50">
        <svg
          className="h-8 w-8 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      <h3 className="mb-2 text-lg font-medium text-white">No ads found</h3>
      <p className="max-w-xs text-sm text-gray-400">
        Try adjusting your search criteria or filters to find more ads.
      </p>
    </div>
  );

  return (
    <div className="ad_card_container w-full">
      <div className="hidden sm:block">
        <ResponsiveMasonry
          columnsCountBreakPoints={{
            0: 1,
            900: isAddieChatVisible ? 1 : 2,
            1400: isAddieChatVisible ? 1 : 2,
          }}
          gutterBreakPoints={{ 0: '12px', 900: '16px', 1300: '20px' }}
        >
          <Masonry>
            {/* Show skeletons when initial loading */}
            {loading &&
              Array.from({ length: skeletonCount })?.map((_, index) => (
                <AdCardSkeleton key={`initial-skeleton-${index}`} />
              ))}

            {/* Show actual ads when not in initial loading */}
            {!loading && renderAdCards(transformedAds)}

            {/* Show scroll loading skeletons AFTER the existing ads */}
            {scrollLoading &&
              !loading &&
              Array.from({ length: skeletonCount })?.map((_, index) => (
                <AdCardSkeleton key={`scroll-skeleton-${index}`} />
              ))}
          </Masonry>
        </ResponsiveMasonry>

        {/* End of results message */}
        {!hasMore && adsData?.length > 0 && (
          <div className="py-4 text-center text-sm text-gray-400">No more ads to load</div>
        )}

        {/* Empty state */}
        {!loading && !scrollLoading && adsData?.length === 0 && (
          <div className="flex h-[800px] items-center justify-center py-8 text-gray-400">
            No ads found
          </div>
        )}
      </div>

      {/* Mobile Horizontal Scroll Layout */}
      <div
        className="w-full overflow-x-auto pb-4 sm:hidden"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="flex flex-row gap-4 px-2" style={{ minHeight: '320px' }}>
          {/* Show skeletons when initial loading */}
          {loading &&
            Array.from({ length: skeletonCount })?.map((_, index) => (
              <div key={`initial-skeleton-mobile-${index}`} className="max-w-[320px] min-w-[260px]">
                <AdCardSkeleton />
              </div>
            ))}

          {/* Show actual ads when not in initial loading */}
          {!loading &&
            transformedAds?.map((ad, index) => (
              <div key={`ad-mobile-${ad?.id}-${index}`} className="max-w-[320px] min-w-[260px]">
                {renderAdCards([ad])}
              </div>
            ))}

          {/* Show scroll loading skeletons AFTER the existing ads */}
          {scrollLoading &&
            !loading &&
            Array.from({ length: skeletonCount })?.map((_, index) => (
              <div key={`scroll-skeleton-mobile-${index}`} className="max-w-[320px] min-w-[260px]">
                <AdCardSkeleton />
              </div>
            ))}
        </div>

        {/* End of results message */}
        {!hasMore && adsData?.length > 0 && (
          <div className="py-4 text-center text-sm text-gray-400">No more ads to load</div>
        )}

        {/* Empty state */}
        {!loading && !scrollLoading && adsData?.length === 0 && (
          <div className="flex h-[320px] w-full items-center justify-center py-8 text-gray-400">
            No ads found
          </div>
        )}
      </div>
    </div>
  );
};

export default AdCardContainer;
