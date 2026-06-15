import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  fetchAdAccounts,
  fetchGoogleAdAccounts,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import FbConnectStep from '@/components/AdFactory/PostAd/FbConnectStep';
import MySpaceSelectStep from './MySpaceSelectStep';
import MySpaceComposeStep from './MySpaceComposeStep';
import GoogleSelectStep from './GoogleSelectStep';
import GoogleComposeStep from './GoogleComposeStep';
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

// MySpace → Post Ad modal. Step machine:
//   connect → select → compose
//
// `platform` is set when the user clicks "Post Ad" on either the
// Facebook or Google card — routes step 2/3 to the right component
// (MySpaceSelectStep + MySpaceComposeStep for Meta, GoogleSelectStep +
// GoogleComposeStep for Google).
//
// `autoAdvance` (set only when restoring after an OAuth round-trip)
// is honored ONCE — the moment we can infer which platform just
// connected we jump to `select`. Manual Back-to-platforms isn't
// overridden after that.
export default function PostAdMySpaceModal({
  open,
  onOpenChange,
  payload,
  autoAdvance = false,
}) {
  const dispatch = useDispatch();
  const fbUser = useSelector((state) => state.adFactoryNew?.fbUser);
  const googleUser = useSelector((state) => state.adFactoryNew?.googleUser);
  const isFbConnected = Boolean(fbUser?.facebookId && fbUser?._id);
  const isGoogleConnected = Boolean(googleUser?._id);

  const [step, setStep] = useState('connect');
  const [platform, setPlatform] = useState(null); // 'facebook' | 'google' | null
  const [selection, setSelection] = useState(null);
  // One-shot flag: arms when the restored flow can't yet infer which
  // platform just connected (Redux race after page reload). Disarms
  // the moment we advance.
  const [pendingAutoAdvance, setPendingAutoAdvance] = useState(false);

  // Pick which platform's `select` step the restored flow lands on.
  // Exactly-one-connected = clear winner; both-connected = ambiguous,
  // so we stay on connect step and let the user pick.
  const inferPlatformForAutoAdvance = () => {
    if (isFbConnected && !isGoogleConnected) return 'facebook';
    if (isGoogleConnected && !isFbConnected) return 'google';
    return null;
  };

  // On every open: reset state, prime whichever ad-account list is
  // available, persist payload so an OAuth redirect mid-flow can
  // restore the modal on page reload.
  useEffect(() => {
    if (!open) return;
    setSelection(null);

    const inferred = autoAdvance ? inferPlatformForAutoAdvance() : null;
    if (autoAdvance && inferred) {
      setPlatform(inferred);
      setStep('select');
      setPendingAutoAdvance(false);
    } else {
      setPlatform(null);
      setStep('connect');
      // Only arm if we're in the restored flow but neither user
      // populated yet — the second effect below resolves it.
      setPendingAutoAdvance(autoAdvance && !inferred);
    }

    if (isFbConnected && fbUser?._id) {
      dispatch(fetchAdAccounts(fbUser._id));
    }
    if (isGoogleConnected && googleUser?._id) {
      dispatch(fetchGoogleAdAccounts(googleUser._id));
    }
    if (payload) savePendingPostAd(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoAdvance, isFbConnected, isGoogleConnected, fbUser?._id, googleUser?._id, dispatch, payload]);

  // Honor a pending auto-advance once Redux populates whichever user.
  useEffect(() => {
    if (!open || !pendingAutoAdvance || step !== 'connect') return;
    const inferred = inferPlatformForAutoAdvance();
    if (inferred) {
      setPlatform(inferred);
      setStep('select');
      setPendingAutoAdvance(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingAutoAdvance, step, isFbConnected, isGoogleConnected]);

  const handleSelectPlatform = (platformKey) => {
    if (platformKey === 'facebook' && isFbConnected) {
      setPlatform('facebook');
      setStep('select');
    } else if (platformKey === 'google' && isGoogleConnected) {
      setPlatform('google');
      setStep('select');
    }
    // If not yet connected for that platform, FbConnectStep itself
    // kicks the OAuth redirect — nothing to do here.
  };

  // Wrap onOpenChange so manual dismissal clears the persisted payload.
  // We do NOT clear on OAuth redirect — the whole page tears down
  // before any close handler fires, which is exactly what lets the
  // next mount restore the modal.
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

  const SelectComponent = platform === 'google' ? GoogleSelectStep : MySpaceSelectStep;
  const ComposeComponent = platform === 'google' ? GoogleComposeStep : MySpaceComposeStep;

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
                  <SelectComponent
                    payload={resolvedPayload}
                    onBack={() => {
                      setPlatform(null);
                      setStep('connect');
                    }}
                    onNext={(sel) => {
                      setSelection(sel);
                      setStep('compose');
                    }}
                  />
                </div>
                <div className={showCompose ? 'block' : 'hidden'}>
                  <ComposeComponent
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
