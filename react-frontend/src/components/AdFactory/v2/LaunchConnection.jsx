import React, { useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import FacebookAccountSelector from '@/components/MetaAds/FacebookAccountSelector';
import QuickTemplateSetup, {
  emptyAutoSetup,
  isAutoSetupComplete,
} from '@/components/AdFactory/Automation/QuickTemplateSetup';
import { LABEL } from './_tokens';

// ----------------------------------------------------------------------------
// LaunchConnection — the four ids activation needs, and nothing more.
//
// NOT a card. It renders bare fields and is embedded inside KeepTheseComing's
// "Where these publish" band, which supplies the heading and the surface. It
// used to be its own panel below that card, which put the account PICKERS in
// one box and a read-only report of the same two values in another.
//
//   facebookId + connectionId  which Meta account we post through
//   adAccountId + pageId       which account pays, which Page it runs under
//
// These are the only things the backend genuinely cannot infer. Objective,
// optimisation goal, billing event, bid strategy and CTA all come from the
// brief and the objective's own wizardSchema cell — the template is
// synthesised, so there is no saved template to pick.
//
// Both halves are reused rather than rebuilt: `FacebookAccountSelector` is the
// same component the automation form uses, and `QuickTemplateSetup` is the ad
// account + Page picker built for Phase 1's "set it up for me" path. It already
// auto-selects when there is exactly one of either — asking someone to choose
// from a list of one is a question with no information in it.
// ----------------------------------------------------------------------------

export const emptyConnection = () => ({
  facebookId: '',
  connectionId: '',
  ...emptyAutoSetup(),
});

// Activation needs all four. Objective/conversionLocation ride along from
// `emptyAutoSetup` but are supplied by the brief, not by this component.
export const isConnectionComplete = (conn) =>
  Boolean(conn?.facebookId && conn?.connectionId) && isAutoSetupComplete(conn);

export default function LaunchConnection({ value, onChange, disabled = false }) {
  const conn = value || emptyConnection();
  const { userData } = useSelector((state) => state.socket) || {};

  const handleAccount = useCallback(
    (account) => {
      const facebookId = account?.facebookId || '';
      const connectionId = account?._id || '';
      // A different Meta account means different ad accounts and Pages —
      // clear both rather than carrying a selection that may not belong to it.
      const changedAccount = facebookId && facebookId !== conn.facebookId;
      onChange?.({
        ...conn,
        facebookId,
        connectionId,
        ...(changedAccount
          ? { adAccountId: '', adAccountName: '', pageId: '', pageName: '' }
          : {}),
      });
    },
    [conn, onChange],
  );

  const handleSetup = useCallback(
    (auto) => onChange?.({ ...conn, ...auto }),
    [conn, onChange],
  );

  const autoValue = useMemo(
    () => ({
      adAccountId: conn.adAccountId,
      adAccountName: conn.adAccountName,
      pageId: conn.pageId,
      pageName: conn.pageName,
      objective: conn.objective,
      conversionLocation: conn.conversionLocation,
    }),
    [conn],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Meta account</span>
        <FacebookAccountSelector
          userId={userData?.user_id}
          preferredFacebookId={conn.facebookId}
          onChange={handleAccount}
          disabled={disabled}
        />
      </div>

      {conn.facebookId && (
        <QuickTemplateSetup
          value={autoValue}
          facebookId={conn.facebookId}
          disabled={disabled}
          onChange={handleSetup}
        />
      )}
    </div>
  );
}
