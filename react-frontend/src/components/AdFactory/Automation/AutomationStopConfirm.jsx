import React from 'react';
import { motion } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'react-toastify';
import {
  closeAutomationStopConfirm,
  selectAutomationSaving,
  selectStopConfirmFor,
} from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';
import { deleteAutomation } from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';

// ----------------------------------------------------------------------------
// AutomationStopConfirm — irreversible-action gate for the Stop button on
// the AutomationActiveNode. Calls deleteAutomation which hits the backend's
// DELETE /jobs/:id, clears the Redux entry, and lets the canvas revert to
// manual mode.
// ----------------------------------------------------------------------------

export default function AutomationStopConfirm() {
  const dispatch = useDispatch();
  const campaignId = useSelector(selectStopConfirmFor);
  const saving = useSelector(selectAutomationSaving);

  if (!campaignId) return null;

  const close = () => dispatch(closeAutomationStopConfirm());

  const handleConfirm = async () => {
    const res = await dispatch(deleteAutomation(campaignId));
    if (deleteAutomation.fulfilled.match(res)) {
      toast.success('Automation stopped');
      close();
    } else {
      // Show the backend's actual rejection reason (e.g. permission errors)
      // instead of a generic message.
      toast.error(
        res?.payload?.message || res?.error?.message || 'Could not stop automation'
      );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={close}
      className="fixed inset-0 z-1001 flex items-center justify-center bg-[#0D0D0D]/70 p-4 backdrop-blur-2xl"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-red-500/20 bg-[#1a1a1a] p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-500/30">
            <AlertTriangle className="size-5 text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-white">Stop automation?</h3>
            <p className="mt-1 text-sm text-[#AFAFAF]">
              The schedule and run history for this campaign will be removed. The downstream nodes
              (Image Gen, Text Gen, Prepare Creatives, Post Ad) will return to manual mode. This
              cannot be undone.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-lg border border-white/10 px-4 py-1.5 text-sm text-[#E3E3E3] transition hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-4 py-1.5 text-sm font-medium text-red-300 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Stop &amp; remove
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
