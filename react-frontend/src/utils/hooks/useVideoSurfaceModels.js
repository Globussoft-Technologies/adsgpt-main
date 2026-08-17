import { useEffect, useState } from 'react';
import { fetchVideoSurfaceModels } from '@/utils/fetchModelCredits';

// Availability is deliberately not backed by a frontend fallback. The API is
// the source of truth so globally disabled or surface-disabled models cannot
// reappear while the request is loading or when it fails.
export function useVideoSurfaceModels(media) {
  return useVideoSurfaceModelsState(media).models;
}

export function useVideoSurfaceModelsState(media) {
  const [models, setModels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setIsLoading(true);
    fetchVideoSurfaceModels(media)
      .then((rows) => {
        if (!cancelled) setModels(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        console.error(`Failed to load ${media} video models:`, error);
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [media]);

  return { models, isLoading };
}
