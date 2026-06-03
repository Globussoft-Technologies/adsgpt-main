import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { fetchAdAccounts } from '@/store/actions/adFactoryNew/adFactoryActions';
import FbConnectStep from '@/components/AdFactory/PostAd/FbConnectStep';
import MySpaceSelectStep from './MySpaceSelectStep';
import MySpaceComposeStep from './MySpaceComposeStep';
import {
  POST_AD_PENDING_KEY,
  savePendingPostAd,
  clearPendingPostAd,
} from './postAdPersistence';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

const resolveMediaUrl = (url) => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${S3_BASE_URL}${url}`;
};

// MySpace → Meta Post Ad modal. Step machine:
//   connect → select → compose
//
// `autoAdvance` (set only when restoring after an FB OAuth round-trip)
// is honored ONCE — the moment fbUser is known to be connected, we
// jump to `select`. After that, the user can freely use the Back
// button to return to `connect` without the auto-advance re-firing.
export default function PostAdMySpaceModal({
  open,
  onOpenChange,
  payload,
  autoAdvance = false,
}) {
  const dispatch = useDispatch();
  const fbUser = useSelector((state) => state.adFactoryNew?.fbUser);
  const isFbConnected = Boolean(fbUser?.facebookId && fbUser?._id);

  const [step, setStep] = useState('connect');
  const [selection, setSelection] = useState(null);
  // One-shot flag: arms when the modal opens via autoAdvance and isn't
  // yet connected (so we wait for Redux to populate), disarms the
  // moment we advance — so manual Back-to-platforms isn't overridden.
  const [pendingAutoAdvance, setPendingAutoAdvance] = useState(false);

  // On every open: reset state, prime ad-accounts, persist payload so an
  // OAuth redirect mid-flow can restore the modal on page reload.
  useEffect(() => {
    if (!open) return;
    setSelection(null);
    if (autoAdvance && isFbConnected) {
      setStep('select');
      setPendingAutoAdvance(false);
    } else {
      setStep('connect');
      // Only arm if we couldn't advance immediately — i.e. we're in the
      // restored flow but fbUser hasn't populated yet.
      setPendingAutoAdvance(autoAdvance && !isFbConnected);
    }
    if (isFbConnected && fbUser?._id) {
      dispatch(fetchAdAccounts(fbUser._id));
    }
    if (payload) savePendingPostAd(payload);
  }, [open, autoAdvance, isFbConnected, fbUser?._id, dispatch, payload]);

  // Honor a pending auto-advance once Redux populates fbUser.
  useEffect(() => {
    if (open && pendingAutoAdvance && step === 'connect' && isFbConnected) {
      setStep('select');
      setPendingAutoAdvance(false);
    }
  }, [open, pendingAutoAdvance, step, isFbConnected]);

  const handleSelectPlatform = (platformKey) => {
    if (platformKey === 'facebook' && isFbConnected) {
      setStep('select');
    }
    // Google is phase 2 — leave the connect step rendered so the user can
    // still kick the OAuth redirect from FbConnectStep itself.
  };

  // Wrap onOpenChange so manual dismissal clears the persisted payload.
  // (We do NOT clear on FB-OAuth redirect — the whole page tears down
  // before any close handler fires, which is exactly what lets the next
  // mount restore the modal.)
  const handleOpenChange = (next) => {
    if (!next) clearPendingPostAd();
    onOpenChange(next);
  };

  const resolvedPayload = payload
    ? { ...payload, url: resolveMediaUrl(payload.url) }
    : null;

  // Render select + compose with show/hide (not conditional mount) so
  // that going Back from compose → select preserves the dropdown picks
  // and going forward again preserves the compose form text. Connect
  // remains a true conditional render — going back to it implies a
  // connection change and fresh state is correct there.
  const showSelect = step === 'select';
  const showCompose = step === 'compose';
  const showStepperSteps = step !== 'connect';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="backdrop-blur-100 w-[96%] !max-w-3xl scale-100! overflow-hidden rounded-[30px] border border-white/10 bg-[#1a1a1a] px-6 pt-16 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] outline-none focus:outline-none focus-visible:ring-0 focus-visible:outline-none md:w-full 2xl:!max-w-5xl 2xl:pt-20"
      >
        <div className="max-h-[calc(100svh-200px)] space-y-4 overflow-y-auto sm:px-6">
          <div className="pb-10">
            {step === 'connect' && (
              <FbConnectStep
                onSelectPlatform={handleSelectPlatform}
                connectedActionLabel="Post Ad"
              />
            )}

            {showStepperSteps && (
              <>
                <div className={showSelect ? 'block' : 'hidden'}>
                  <MySpaceSelectStep
                    onBack={() => setStep('connect')}
                    onNext={(sel) => {
                      setSelection(sel);
                      setStep('compose');
                    }}
                  />
                </div>
                <div className={showCompose ? 'block' : 'hidden'}>
                  <MySpaceComposeStep
                    payload={resolvedPayload}
                    selection={selection}
                    onBack={() => setStep('select')}
                    onPosted={() => handleOpenChange(false)}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Re-export so consumers don't have to know the storage module.
export { POST_AD_PENDING_KEY };
