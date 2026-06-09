import { useWindowSize } from '@react-hook/window-size';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Masonry from 'react-masonry-css';
import AdGalleryCard from '../AdGalleryCard';
import AdCreativeCardLoader from '@/components/AdStudio/Loader/Cards/AdCreativeCardLoader';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSavedItems } from '@/store/actions/brandIQ/myBrandActions';
import ShowLightBox from '@/components/common/ShowLightBox';
import { Loader } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import AdCreativeEditorLightBox from '../../CreativeChat/Lightbox/AdCreativeEditorLightBox';
import { resetEditorSlice } from '@/store/reducers/adStudio/editorSlice';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const NAS_CREATIVE_URL = import.meta.env.VITE_NAS_CREATIVE_URL;

const MasonryGalleryLayout = ({ toggleOpenAdCreativeChat }) => {
  const [width] = useWindowSize();
  const dispatch = useDispatch();
  const userData = useSelector((state) => state.socket.userData);
  const { baseWithLogoImage } = useSelector((state) => state.editor);
  const { myGallery, galleryloading, activeBrandIQTabId } = useSelector(
    (state) => state.brandIQTabs
  );

  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const limit = 15;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const closeNormalLightbox = () => {
    setLightboxOpen(false);
  };
  const closeLightbox = () => {
    dispatch(resetEditorSlice());
  };
  const containerRef = useRef(null);
  const sentinelRef = useRef(null);

  useEffect(() => {
    // This will run every time the component mounts or the activeBrandIQTabId changes to 'Gallery'
    if (activeBrandIQTabId === 'Gallery') {
      const scrollContainer = containerRef.current;
      if (scrollContainer) {
        // Use setTimeout to ensure the DOM is ready
        setTimeout(() => {
          scrollContainer.scrollTop = 0;
        }, 0);
      } else {
        // Fallback to window scrolling
        setTimeout(() => {
          window.scrollTo(0, 0);
        }, 0);
      }
    }
  }, [activeBrandIQTabId]);
  // AdCreativeCardLoader.jsx

  const AdCreativeCardLoader = () => {
    return (
      <div className="w-full animate-pulse overflow-hidden rounded-xl border border-gray-200 shadow-lg dark:border-gray-700">
        {/* Header loader */}
        <div className="p-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-r from-gray-300 to-gray-200 dark:from-gray-600 dark:to-gray-500"></div>
            <div className="h-4 flex-1 rounded bg-gradient-to-r from-gray-300 to-gray-200 dark:from-gray-600 dark:to-gray-500"></div>
          </div>
        </div>

        {/* Image loader with shimmer effect */}
        <div className="relative h-64 w-full overflow-hidden bg-gradient-to-r from-gray-300 to-gray-200 dark:from-gray-600 dark:to-gray-500">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
        </div>

        {/* Content loader */}
        <div className="space-y-3 p-4">
          <div className="h-4 w-3/4 rounded bg-gradient-to-r from-gray-300 to-gray-200 dark:from-gray-600 dark:to-gray-500"></div>
          <div className="h-3 w-full rounded bg-gradient-to-r from-gray-300 to-gray-200 dark:from-gray-600 dark:to-gray-500"></div>
          <div className="h-3 w-2/3 rounded bg-gradient-to-r from-gray-300 to-gray-200 dark:from-gray-600 dark:to-gray-500"></div>
        </div>
      </div>
    );
  };

  // Format the backend URL to include the actual image URL
  const formatImageUrl = (imagePath) => {
    if (!imagePath) return '';
    return imagePath.includes('/creatives')
      ? `${S3_BASE_URL}${imagePath}`
      : `${NAS_CREATIVE_URL}${imagePath}`;
  };

  // Transform gallery data to match AdGalleryCard props
  const transformedGalleryData = useMemo(() => {
    if (!myGallery?.data) return [];

    return myGallery.data.map((item, index) => ({
      id: item._id,
      image: formatImageUrl(item.image_url),
      editimg: item.image_url,
      createdAt: item.createdAt,
    }));
  }, [myGallery, userData]);
  const lightboxImages = useMemo(
    () => transformedGalleryData.map((item) => item.image),
    [transformedGalleryData]
  );
  // Check if we have more data to load
  useEffect(() => {
    if (myGallery) {
      const totalItems = myGallery.total || 0;
      const currentItems = myGallery.data?.length || 0;
      setHasMore(currentItems < totalItems);
    }
  }, [myGallery]);

  // Initial load
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      setSkip(0);
      await dispatch(fetchSavedItems({ userId: userData?.user_id, skip: 0, limit }));
      setLoading(false);
    };

    if (userData?.user_id) {
      loadInitialData();
    }
  }, [dispatch, userData?.user_id]);

  // Load more function
  const loadMore = useCallback(async () => {
    if (isFetchingMore || !hasMore || !userData?.user_id) return;

    setIsFetchingMore(true);
    const newSkip = skip + limit;

    try {
      await dispatch(fetchSavedItems({ userId: userData.user_id, skip: newSkip, limit }));
      setSkip(newSkip);
    } catch (error) {
      console.error('Error loading more items:', error);
    } finally {
      setIsFetchingMore(false);
    }
  }, [dispatch, userData?.user_id, skip, limit, isFetchingMore, hasMore]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingMore && !loading) {
          loadMore();
        }
      },
      {
        root: null,
        rootMargin: '200px',
        threshold: 0.1,
      }
    );

    if (!sentinelRef.current) {
      sentinelRef.current = document.createElement('div');
      sentinelRef.current.style.height = '1px';
      sentinelRef.current.style.visibility = 'hidden';
    }

    if (containerRef.current && sentinelRef.current) {
      containerRef.current.appendChild(sentinelRef.current);
      observer.observe(sentinelRef.current);
    }

    return () => {
      if (sentinelRef.current) {
        observer.unobserve(sentinelRef.current);
        if (containerRef.current && containerRef.current.contains(sentinelRef.current)) {
          containerRef.current.removeChild(sentinelRef.current);
        }
      }
    };
  }, [loadMore, hasMore, isFetchingMore, loading]);

  // Breakpoints for masonry layout
  const columnCount = useMemo(() => {
    if (width < 500) return 1;
    if (width < 750) return 2;
    if (width < 900) return 2;
    if (width < 1200) return 3;
    if (width < 1700) return 4;
    return 5;
  }, [width]);

  const masonryBreakpoints = useMemo(() => {
    return {
      default: columnCount,
      1700: 4,
      1200: 3,
      900: 2,
      750: 2,
      500: 1,
    };
  }, [columnCount]);

  // Show initial loading state
  if (loading && transformedGalleryData.length === 0) {
    return (
      // <div className="box-border h-full w-full overflow-x-hidden overflow-y-auto px-4 pb-40 md:px-10">
      //   <div className="box-border p-4">
      //     <Masonry
      //       breakpointCols={masonryBreakpoints}
      //       className="my-masonry-grid outline-none"
      //       columnClassName="my-masonry-grid_column"
      //     >
      //       {Array.from({ length: 12 }).map((_, index) => (
      //         <div key={index} className="mb-4">
      //           <AdCreativeCardLoader />
      //         </div>
      //       ))}
      //     </Masonry>
      //   </div>
      // </div>
      <div className="flex min-h-[55vh] w-full items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-gray-600" />
      </div>
    );
  }

  // Show empty state
  if (!loading && transformedGalleryData.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="mx-auto mb-4 h-24 w-24 animate-pulse rounded-full bg-gradient-to-r from-gray-200 to-gray-300"></div>
          <p className="mb-2 text-lg font-medium">No saved items yet</p>
          <p className="text-sm text-gray-400">Your saved creatives will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="box-border h-full w-full overflow-x-hidden overflow-y-auto pb-40"
    >
      <div className="box-border p-0 2xl:px-4">
        <Masonry
          breakpointCols={masonryBreakpoints}
          className="my-masonry-grid outline-none"
          columnClassName="my-masonry-grid_column"
        >
          {/* Main content */}
          {transformedGalleryData.map((item, index) => (
            <AdGalleryCard
              image={item.image}
              editimg={item.editimg}
              onClick={() => setLightboxIndex(index)}
            />
          ))}
        </Masonry>
        {/* Loading more items - integrated into masonry grid */}
        {(isFetchingMore || galleryloading) && (
          // Array.from({ length: columnCount * 2 }).map((_, index) => (
          //   <div key={`loader-${index}`} className="mb-4">
          //     <AdCreativeCardLoader />
          //   </div>
          // ))
          <div className="flex w-full items-center justify-center">
            <Loader className="h-10 w-10 animate-spin text-gray-400" />
          </div>
        )}
        {/* No more items message */}
        {/* {!hasMore && transformedGalleryData.length > 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-blue-100 to-purple-100">
                <div className="h-6 w-6 rounded-full bg-gradient-to-r from-blue-400 to-purple-400"></div>
              </div>
              <p className="font-medium text-gray-500">You've reached the end</p>
              <p className="mt-1 text-sm text-gray-400">No more items to load</p>
            </div>
          </div>
        )} */}
        {/* Lightbox */}
        <AnimatePresence>
          {lightboxIndex !== null && (
            <ShowLightBox
              images={lightboxImages}
              currentIndex={lightboxIndex}
              setCurrentIndex={setLightboxIndex}
              closeLightbox={() => setLightboxIndex(null)}
            />
          )}
        </AnimatePresence>

        {lightboxOpen && (
          <ShowLightBox lightboxImage={lightboxOpen} closeLightbox={closeNormalLightbox} />
        )}
      </div>
    </div>
  );
};

export default MasonryGalleryLayout;
