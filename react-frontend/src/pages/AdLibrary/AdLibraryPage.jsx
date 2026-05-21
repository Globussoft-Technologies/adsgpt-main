import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import MasonryResponsiveLayout from '@/components/AdStudio/AdCreatives/Cards/layout/MasonryResponsiveLayout';
import { fetchExploreAds } from '@/store/actions/adStudio/adCreativeActions';

export default function AdLibraryPage() {
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
  const user_id = userData?.user_id;

  useEffect(() => {
    if (user_id) dispatch(fetchExploreAds());
  }, [dispatch, user_id]);

  return (
    <div className="h-full w-full">
      <MasonryResponsiveLayout />
    </div>
  );
}
