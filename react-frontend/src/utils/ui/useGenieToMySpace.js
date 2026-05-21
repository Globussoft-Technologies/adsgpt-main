import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import genieMinimize, { captureModal } from './genieMinimize';
import {
  setActivePage,
  setMySpaceTab,
  showSavedFolder,
  incrementSavedCount,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import { setActiveAdStudioTab } from '@/store/reducers/adStudio/adStudioTabsSlice';
import { fetchProcessingCount } from '@/store/actions/adVideoNew/Advideoactions';
import router from '@/routes/router';

// Plays the genie-minimize animation from `modalRef` toward `targetRef`,
// then switches the AdStudio over to AdVideo > MySpace and selects the
// correct tab. `kind` is 'image' (default) or 'video'.
//
// Both refs must be attached when this fires; the modal node is captured
// to a snapshot canvas before the animation runs. If either ref is empty
// the animation is skipped and we just navigate.
export function useGenieToMySpace(modalRef, targetRef) {
  const dispatch = useDispatch();

  return useCallback(
    async (kind = 'image', options = {}) => {
      const modal = modalRef?.current;
      // Prefer the real sidebar My Space button (bottom-left) so the genie
      // flies toward it. Falls back to the caller-supplied ref only if the
      // sidebar isn't currently mounted (e.g. mobile drawer closed).
      const targetEl =
        document.getElementById('sidebar-my-space-button') || targetRef?.current;

      if (modal && targetEl) {
        const snapshot = await captureModal(modal);
        modal.style.opacity = '0';
        // Hand control back to the caller right after capture so it can
        // close the parent dialog (and dismiss its overlay) BEFORE the
        // animation plays. The snapshot lives in document.body and is
        // independent of the modal — closing the original is safe.
        options.onCaptured?.();
        await new Promise((resolve) => genieMinimize(snapshot, targetEl, resolve));
        // Intentionally NOT restoring opacity here. The dispatches below
        // either unmount the modal (tab/page change) or close the parent
        // dialog — restoring at this point caused the modal content to
        // flash back for one frame before the new layout took over,
        // showing up as a "second effect" right after the genie.
      }

      // When the trigger fires from a route outside AdStudio (e.g. the
      // AdLibrary RecreateAdModal lives on /ad-library), redux state
      // changes alone don't move the user — push them onto /adstudio
      // first so AdStudioPage mounts and picks up the new tab.
      try {
        const currentPath = router?.state?.location?.pathname || '';
        if (!currentPath.includes('/adstudio')) {
          router.navigate('/adstudio');
        }
      } catch {
        /* router state may not be initialised in tests — best-effort */
      }

      dispatch(setMySpaceTab(kind === 'video' ? 'videos' : 'images'));
      dispatch(setActiveAdStudioTab('adVideoNew'));
      dispatch(setActivePage('myVideos'));
      dispatch(showSavedFolder());
      dispatch(incrementSavedCount());
      dispatch(fetchProcessingCount());
    },
    [dispatch, modalRef, targetRef]
  );
}
