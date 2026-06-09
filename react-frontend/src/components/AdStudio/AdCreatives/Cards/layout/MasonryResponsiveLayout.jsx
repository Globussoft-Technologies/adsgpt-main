import { memo, useEffect, useRef, useState } from 'react';
import Masonry, { ResponsiveMasonry } from 'react-responsive-masonry';
import AdCreativesCard from '../AdCreativeCard';
import AdCreativeCardLoader from '@/components/AdStudio/Loader/Cards/AdCreativeCardLoader';
import { fetchExploreAds } from '@/store/actions/adStudio/adCreativeActions';
import { useDispatch, useSelector } from 'react-redux';
import { Loader } from 'lucide-react';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';

const MasonryResponsiveLayout = () => {
  const dispatch = useDispatch();
  const { exploreAdsLoading, exploreAds, onScrollLoading, exploreHasMore } = useSelector(
    (state) => state.adCreative
  );
  const { userData } = useSelector((state) => state.socket);
  const user_id = userData?.user_id;

  const containerRef = useRef(null);

  const [lightboxData, setLightboxData] = useState(null);
  const closeNormalLightbox = () => {
    setLightboxData(null);
  };

  // useEffect(() => {
  //   if (user_id) dispatch(fetchExploreAds());
  // }, [dispatch, user_id]);

  // Scroll handler
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;

      // If user scrolled within 300px of bottom
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        if (!onScrollLoading && exploreHasMore) {
          dispatch(fetchExploreAds());
        }
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [dispatch, onScrollLoading, exploreHasMore]);

  return (
    <div
      ref={containerRef}
      className="box-border h-[calc(100svh-80px)] w-full overflow-x-hidden overflow-y-auto p-0 pb-40 lg:px-10 2xl:h-[calc(100svh-112px)] 2xl:px-16"
    >
      <div className="2xlp-4 box-border lg:p-2">
        {exploreAdsLoading || !user_id ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 2xl:gap-5">
            {Array.from({ length: 20 }).map((_, index) => (
              <AdCreativeCardLoader key={index} />
            ))}
          </div>
        ) : (
          <>
            {Array.isArray(exploreAds) && exploreAds.length > 0 ? (
              <ResponsiveMasonry
                columnsCountBreakPoints={{
                  0: 1,
                  500: 2,
                  750: 2,
                  900: 3,
                  1200: 4,
                  1700: 4,
                }}
                gutterBreakPoints={{ 0: '14px', 1280: '20px' }}
              >
                <Masonry className="outline-none">
                  {exploreAds.map((item, i) => (
                    <AdCreativesCard
                      key={i}
                      userName={item?.postOwner}
                      userAvatar={item?.postOwnerImage}
                      image={item?.postImage}
                      title={item?.adTitle}
                      description={item?.description || item?.newsfeedDescription}
                      otherMedia={item?.otherMedia}
                      ad={item}
                      setLightboxOpen={setLightboxData}
                    />
                  ))}
                </Masonry>
              </ResponsiveMasonry>
            ) : (
              <div className="no_found_text flex h-full min-h-[55vh] items-center justify-center p-4">
                <p className="text-center text-xl font-medium text-zinc-600 dark:text-[#C9C9C9]">
                  No results found. Try a different competitor or keyword.
                </p>
              </div>
            )}
          </>
        )}
      </div>
      {onScrollLoading && (
        <div className="flex items-center justify-center py-6">
          <Loader className="h-10 w-10 animate-spin text-gray-400" />
        </div>
      )}
      {lightboxData && (
        <ShowLightBox
          lightboxImage={lightboxData.activeImage}
          images={lightboxData.images}
          closeLightbox={closeNormalLightbox}
        />
      )}
    </div>
  );
};

export default memo(MasonryResponsiveLayout);
