import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import AdCreativeNewHome from './AdCreativeNewHome';
import { LifestyleAdsFlow } from './lifestyle/LifestyleAdsFlow';
import { AiCreativesCustom } from './ai-creatives/AiCreativesCustom';
import {
  setActiveAdStudioTab,
  setAdCreativeNewActivePage,
} from '@/store/reducers/adStudio/adStudioTabsSlice';
import {
  setActivePage,
  setMySpaceTab,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import { useGenieToMySpace } from '@/utils/ui/useGenieToMySpace';

const FLOW_TITLES = {
  lifestyle: 'Lifestyle Ads',
  'product-shot': 'Product Shots',
  'apps-saas': 'App/Saas Ads',
  'brand-awareness': 'Brand Awareness Ads',
};

const AdCreativeNewLayout = () => {
  // Route is driven by redux so external triggers (e.g. MySpace > Images >
  // Recreate) can navigate here by dispatching setAdCreativeNewActivePage.
  const route = useSelector((s) => s.adStudioTabs.adCreativeNewActivePage) || 'home';
  // Used as the "did we just arrive via Recreate?" signal — the Recreate
  // button stashes inputs into image.recreateInputs immediately before
  // navigating here, so its presence means "honour whatever route redux
  // currently holds". Otherwise we want a fresh entry to land on home.
  const hasRecreateInputs = useSelector((s) => Boolean(s.image.recreateInputs));
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const setRoute = (next) => dispatch(setAdCreativeNewActivePage(next));

  // Modal node + invisible top-right anchor that the genie animation lands on.
  // The flow components render inside the modal wrapper so html-to-image can
  // capture whatever step they happen to be showing at completion time.
  const modalRef = useRef(null);
  const mySpaceIconRef = useRef(null);
  const triggerGenieToMySpace = useGenieToMySpace(modalRef, mySpaceIconRef);

  // Capture "did we arrive via Recreate?" at first render. The flag is
  // read by the form's back-arrow to decide whether to return to home
  // (normal entry) or MySpace > Images (Recreate flow). recreateInputs
  // is wiped after prefill, so we cache the decision once on mount.
  const [fromRecreate] = useState(() => hasRecreateInputs);

  // Reset to home on mount UNLESS we got here via the Recreate flow.
  // StrictMode double-mounts the layout in dev — both runs see the same
  // hasRecreateInputs check, so the recreate route is preserved on both
  // and a normal entry resets cleanly on both.
  useEffect(() => {
    const routeHint = searchParams.get('creative');
    if (hasRecreateInputs && routeHint) {
      dispatch(setAdCreativeNewActivePage(routeHint));
      return;
    }
    if (!hasRecreateInputs) {
      dispatch(setAdCreativeNewActivePage('home'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectCategory = (key) => {
    if (key === 'lifestyle') setRoute('lifestyle');
    else if (key === 'ai-creatives') setRoute('ai-creatives');
    else if (key === 'product-shot') setRoute('product-shot');
    else if (key === 'apps-saas') setRoute('apps-saas');
    else if (key === 'brand-awareness') setRoute('brand-awareness');
  };

  // Form back-arrow handler. When the user opened this form via MySpace >
  // Recreate, send them back to MySpace > Images instead of the module
  // picker home. Otherwise reset to home like a normal in-tab back.
  const handleFormClose = () => {
    if (fromRecreate) {
      setRoute('home');
      dispatch(setActiveAdStudioTab('adVideoNew'));
      dispatch(setActivePage('myVideos'));
      dispatch(setMySpaceTab('images'));
      return;
    }
    setRoute('home');
  };

  if (route === 'home') {
    return <AdCreativeNewHome onSelectCategory={handleSelectCategory} />;
  }

  return (
    <>
      {/* Hidden genie target — zero-size, top-right, matches the AdVideo pattern. */}
      <span
        ref={mySpaceIconRef}
        aria-hidden
        className="pointer-events-none fixed right-4 top-[700px] h-0 w-0"
      />
      <div ref={modalRef}>
        {route === 'ai-creatives' ? (
          <AiCreativesCustom
            onClose={handleFormClose}
            onComplete={() => triggerGenieToMySpace('image')}
          />
        ) : (
          <LifestyleAdsFlow
            title={FLOW_TITLES[route]}
            variant={route}
            onClose={handleFormClose}
            onComplete={() => triggerGenieToMySpace('image')}
          />
        )}
      </div>
    </>
  );
};

export default AdCreativeNewLayout;
