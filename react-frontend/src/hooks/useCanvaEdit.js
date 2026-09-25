// hooks/useCanvaEdit.js
//
// Shared "Edit in Canva" flow, reused by the image surfaces that offer the
// action (MySpace AdCreative gallery + MySpace AdFactory gallery). Calls
// checkCanvaAuth: if already connected it redirects straight to the upload
// endpoint, otherwise it kicks off the Canva OAuth authorize flow. Loading is
// keyed by image URL so a grid of cards only spins the button that was clicked.
//
// `{ newTab: true }` (onboarding's clip screen) runs the same flow in a new tab
// instead of replacing this one: the Canva round-trip never comes back here, so
// on a page the user is in the middle of, replacing it would strand them in
// Canva with their session one reload away. MySpace passes nothing and keeps
// the in-place redirect.
import { useState } from 'react';
import { useSelector } from 'react-redux';
import { checkCanvaAuth } from '@/apis/canva/canvaApi';

const CANVA_CLIENT_ID = import.meta.env.VITE_CANVA_CLIENT_ID;
const CANVA_REDIRECT_URI = import.meta.env.VITE_CANVA_REDIRECT_URI;
const CANVA_SCOPES = import.meta.env.VITE_CANVA_SCOPES;
const BACKEND_URL = import.meta.env.VITE_SOCKET_URL;

export const useCanvaEdit = () => {
  const userId = useSelector((state) => state.socket?.userData?.user_id);
  // URL of the image whose Canva request is in flight, or null when idle.
  const [loadingUrl, setLoadingUrl] = useState(null);

  const editInCanva = async (imageUrl, e, { newTab = false } = {}) => {
    if (e) e.stopPropagation();
    if (!imageUrl) return;
    setLoadingUrl(imageUrl);
    // Opened NOW, blank, and pointed at Canva after the auth check. A tab opened
    // after an `await` is no longer inside the click, and popup blockers stop it.
    const tab = newTab ? window.open('', '_blank') : null;
    const go = (url) => {
      if (tab) tab.location.href = url;
      else window.location.href = url;
    };
    try {
      const result = await checkCanvaAuth(imageUrl);
      if (result.status) {
        go(`${BACKEND_URL}/adsgpt/canva/v2/upload?id=${userId}&url=${encodeURIComponent(imageUrl)}`);
      } else {
        const { state, codeChallenge } = result;
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: CANVA_CLIENT_ID,
          redirect_uri: CANVA_REDIRECT_URI,
          scope: CANVA_SCOPES,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        });
        go(`https://www.canva.com/api/oauth/authorize?${params.toString()}`);
      }
      // In place: keep loadingUrl set — a redirect is in progress, the spinner
      // stays until the page unloads. In a new tab this page stays, so stop.
      if (tab) setLoadingUrl(null);
    } catch (err) {
      console.error('Canva auth error:', err);
      tab?.close();
      setLoadingUrl(null);
    }
  };

  // True while the given image's Canva request is in flight.
  const isCanvaLoading = (imageUrl) => loadingUrl != null && loadingUrl === imageUrl;

  return { editInCanva, isCanvaLoading, canvaLoadingUrl: loadingUrl };
};

export default useCanvaEdit;
