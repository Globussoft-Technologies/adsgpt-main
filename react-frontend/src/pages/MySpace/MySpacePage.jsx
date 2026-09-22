import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import AdVideoLayout from '@/components/AdStudio/AdVideoNew/AdVideoLayout';
import { setActivePage } from '@/store/reducers/adStudio/adVideoNewSlice';

export default function MySpacePage() {
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(setActivePage('myVideos'));
  }, [dispatch]);

  return (
    // `h-full min-h-0` is load-bearing, not cosmetic. The grids inside
    // AdVideoLayout are `h-full overflow-y-auto` scrollers that hang their
    // infinite-scroll `onScroll` off their own box. Without a definite height
    // here the whole chain collapses to `height: auto`, the grid grows with its
    // content, the Layout Outlet scrolls instead, and `onScroll` never fires —
    // i.e. pagination silently dies. AdStudioPage mounts this same layout as
    // `adcopy_container h-full w-full` for the same reason.
    <div className="adcopy_container h-full min-h-0 w-full">
      <AdVideoLayout />
    </div>
  );
}
