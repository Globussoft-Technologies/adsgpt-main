import React, { useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import FacebookAccountSelector from '@/components/MetaAds/FacebookAccountSelector';
import QuickTemplateSetup, {
  emptyAutoSetup,
  isAutoSetupComplete,
} from '@/components/AdFactory/Automation/QuickTemplateSetup';

// ----------------------------------------------------------------------------
// LaunchConnection — the four ids activation needs, and nothing more.
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
    <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-13 font-semibold text-gray-900 dark:text-white">
          Where these publish
        </h3>
        <p className="text-xs text-gray-500 dark:text-white/55">
          We&apos;ll set up the campaign itself — you just pick the account and Page.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-gray-700 dark:text-white/80">
          Meta account
        </span>
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
