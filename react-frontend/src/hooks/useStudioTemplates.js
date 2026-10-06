import { useCallback, useEffect, useMemo } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import {
  fetchStudioTemplates,
  studioTemplatesKey,
} from '@/store/actions/adStudio/studioTemplatesActions';
import { fetchBrands } from '@/store/actions/brandIQ/myBrandActions';

// The last brand the user picked, from the keys TopHeader writes
// (components/layout/header/TopHeader.jsx — per-user key first, then the
// global id, then the cached header snapshot). Storage can be unavailable.
function storedBrandId(userId) {
  try {
    if (userId) {
      const perUser = localStorage.getItem(`adsgpt:selectedBrand:${userId}`);
      if (perUser) return perUser;
    }
    const global = localStorage.getItem('adsgpt:selectedBrandId');
    if (global) return global;
    const raw = localStorage.getItem('adsgpt:last_active_brand_snapshot');
    return raw ? JSON.parse(raw)?.value || '' : '';
  } catch {
    return '';
  }
}

// Short, stable hash of the brand text + images. Only used to key the cache, so
// collisions are harmless (worst case: one stale list until the 10-min TTL).
function contextSignature(brand) {
  const text = `${brand?.description || ''}|${(brand?.imageUrl || []).join(',')}`;
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * Brand-matched DS templates for the gallery on the Ad Creative (`'image'`) or
 * Ad Video (`'video'`) home screen.
 *
 * The brand is the header switcher's selection (`brandIQTabs.selectedCompetitorBrand`,
 * which TopHeader restores/defaults to the first brand once `myBrands` loads).
 * Fetches on mount and whenever the brand or its description/images change;
 * the thunk itself skips the call while a fresh (<10 min) list is cached.
 *
 * Returns:
 *   view: 'brands-loading' | 'no-brand' | 'loading' | 'ready' | 'error'
 *   items, error ({code, message}), brand, isRefreshing,
 *   refresh() — ↻ button: bypasses client + server caches
 *   retry()   — after an error: normal fetch
 *   hasMore, isLoadingMore, loadMoreError, loadMore() — infinite scroll, both
 *     media (video 10 per page, image 20; the server decides the page size)
 */
export default function useStudioTemplates(media) {
  const dispatch = useDispatch();
  const store = useStore();
  const userId = useSelector((state) => state.socket.userData?.user_id);
  const selectedBrand = useSelector((state) => state.brandIQTabs.selectedCompetitorBrand);
  const myBrands = useSelector((state) => state.brandIQTabs.myBrands);
  const brandsStatus = useSelector((state) => state.brandIQTabs.myBrandsStatus);

  // The brand list is normally requested by AdStudioPage once the socket has
  // the user id. If nothing has requested it yet (status still 'idle') but the
  // user is known, ask here — the gallery must not wait on another component.
  // Reads the live status from the store so a request dispatched in the same
  // tick by AdStudioPage isn't duplicated.
  useEffect(() => {
    if (!userId) return;
    if (store.getState().brandIQTabs.myBrandsStatus === 'idle') dispatch(fetchBrands(userId));
  }, [dispatch, store, userId, brandsStatus]);

  // The brand the HEADER shows, chosen the same way it chooses it: the Redux
  // selection when it is in the list; otherwise the last-used brand saved in
  // localStorage (TopHeader's own keys); otherwise the first brand. Before
  // this, the gallery waited for TopHeader's restore effect to fill the Redux
  // selection — and when that didn't happen the header still displayed a brand
  // (its fallback) while the gallery sat on "Finding templates for your brand…"
  // with no request ever sent. TopHeader still writes the selection; this only
  // stops the gallery from depending on when it does.
  // Prefers the live object from myBrands, so an edit made in BrandIQ is seen here.
  const brand = useMemo(() => {
    // Brands without an id can't be selected or matched (see TopHeader's restore).
    const list = Array.isArray(myBrands) ? myBrands.filter((b) => b?.id) : [];
    if (selectedBrand?.id) return list.find((b) => b.id === selectedBrand.id) || selectedBrand;
    if (!list.length) return null;
    const storedId = storedBrandId(userId);
    return list.find((b) => b.id === storedId) || list[0];
  }, [selectedBrand, myBrands, userId]);

  const brandId = brand?.id || '';
  const contextSig = useMemo(() => (brand ? contextSignature(brand) : ''), [brand]);
  const entry = useSelector((state) =>
    brandId ? state.studioTemplates.byKey[studioTemplatesKey(brandId, media, contextSig)] : undefined
  );

  useEffect(() => {
    if (!brandId) return;
    dispatch(fetchStudioTemplates({ brandId, media, contextSig }));
  }, [dispatch, brandId, media, contextSig]);

  const refresh = useCallback(() => {
    if (brandId) dispatch(fetchStudioTemplates({ brandId, media, contextSig, refresh: true }));
  }, [dispatch, brandId, media, contextSig]);

  const retry = useCallback(() => {
    if (brandId) dispatch(fetchStudioTemplates({ brandId, media, contextSig }));
  }, [dispatch, brandId, media, contextSig]);

  // Video infinite scroll: ask for the page after what is held. The thunk's
  // condition drops it when there is no next page or one is already loading,
  // so the gallery's sentinel can call this as often as it likes.
  const nextSkip = entry?.nextSkip;
  const loadMore = useCallback(() => {
    if (brandId && nextSkip) dispatch(fetchStudioTemplates({ brandId, media, contextSig, skip: nextSkip }));
  }, [dispatch, brandId, media, contextSig, nextSkip]);

  const items = entry?.items || [];
  let view;
  // "No brand" only once the brand list has finished loading and nothing is
  // selectable. Before that — brands not requested yet (they wait for the
  // socket's user id), in flight, or loaded with the header's restore effect
  // about to select one — keep showing the skeleton. The header can display a
  // cached brand in that window, so a "Pick a brand" there was simply wrong.
  const brandsSettled = brandsStatus === 'error' || (brandsStatus === 'ok' && !myBrands?.length);
  if (!brandId) view = brandsSettled ? 'no-brand' : 'brands-loading';
  else if (!entry || (entry.status === 'loading' && !items.length)) view = 'loading';
  else if (entry.status === 'error' && !items.length) view = 'error';
  else view = 'ready';

  // TEMP-DEBUG (2026-09-30): diagnosing "stuck skeleton on first load". Remove.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.info('[studioTemplates]', media, {
      view,
      selectedId: selectedBrand?.id || null,
      selectedName: selectedBrand?.name,
      brandId,
      brandName: brand?.name,
      brandsStatus,
      myBrands: Array.isArray(myBrands) ? myBrands.length : typeof myBrands,
      key: brandId ? studioTemplatesKey(brandId, media, contextSig) : null,
      entry: entry ? { status: entry.status, items: entry.items?.length, error: entry.error?.code } : null,
    });
  }, [media, view, selectedBrand, brandId, brand, brandsStatus, myBrands, contextSig, entry]);

  return {
    view,
    items,
    error: entry?.error || null,
    brand,
    isRefreshing: entry?.status === 'loading' && items.length > 0,
    refresh,
    retry,
    hasMore: Boolean(entry?.status === 'ok' && entry?.hasMore),
    isLoadingMore: Boolean(entry?.loadingMore),
    loadMoreError: entry?.loadMoreError || null,
    loadMore,
  };
}
