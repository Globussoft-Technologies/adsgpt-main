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
    <div className="adcopy_container max-h-[calc(100svh-73px)] w-full overflow-y-auto">
      <AdVideoLayout libraryOnly />
    </div>
  );
}
