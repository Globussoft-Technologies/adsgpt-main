import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import MasonryResponsiveLayout from '@/components/AdStudio/AdCreatives/Cards/layout/MasonryResponsiveLayout';
import { fetchExploreAds } from '@/store/actions/adStudio/adCreativeActions';
import CompetitorsHome from '@/components/BrandIQ/Competitors/CompetitorsHome';

export default function AdLibraryPage({ source = 'explore' }) {
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
  const user_id = userData?.user_id;
  const usesBrandCompetitors = source === 'brandCompetitors';

  useEffect(() => {
    if (user_id && !usesBrandCompetitors) dispatch(fetchExploreAds());
  }, [dispatch, user_id, usesBrandCompetitors]);

  if (usesBrandCompetitors) {
    return (
      <div className="h-full w-full">
        <CompetitorsHome surface="adStudioLibrary" />
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <MasonryResponsiveLayout />
    </div>
  );
}
