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
    <div className="adcopy_container w-full">
      <AdVideoLayout />
    </div>
  );
}
