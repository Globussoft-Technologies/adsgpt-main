import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Target, Inbox } from 'lucide-react';
import InputCommonDropdown from '@/components/AdFactory/NodeForms/InputCommonDropdown';
import AdSetMultiSelect from './AdSetMultiSelect';
import {
  fetchAdAccounts,
  fetchFacebookPages,
  fetchCampaign,
  fetchAdsets,
  fetchLeadForms,
} from '@/store/actions/adFactoryNew/adFactoryActions';

// Meta lead ads (OUTCOME_LEADS objective) require an attached Instant Form.
// We surface a Lead Form picker only for that objective.
const LEADS_OBJECTIVE = 'OUTCOME_LEADS';

// ----------------------------------------------------------------------------
// TargetSection — Ad Account → Campaign → Ad Set → Facebook Page cascade.
//
// All four are required. Selecting an upstream dropdown clears the downstream
// fields and lazy-fetches the next level. The Page is independent of the
// account/campaign hierarchy but is collected here so the whole posting
// target lives in one place.
// ----------------------------------------------------------------------------

export default function TargetSection({ value, onChange, disabled }) {
  const dispatch = useDispatch();
  const {
    fbUser,
    adAccDropdown = [],
    facebookPageDropDown = [],
    campaignsDropdown = [],
    adSetDropdown = [],
    leadFormsDropdown = [],
  } = useSelector((state) => state.adFactoryNew || {});

  const target = value || {};
  const accountId = fbUser?._id;
  const isLeadsObjective = target.campaignObjective === LEADS_OBJECTIVE;

  // Fetch ad accounts + pages on mount (independent of cascade choices).
  useEffect(() => {
    if (!accountId) return;
    if (!adAccDropdown.length) dispatch(fetchAdAccounts(accountId));
    if (!facebookPageDropDown.length) dispatch(fetchFacebookPages(accountId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Fetch campaigns whenever the user picks an ad account.
  useEffect(() => {
    if (!accountId || !target.adAccountId) return;
    dispatch(fetchCampaign({ adAccountId: target.adAccountId, accountId }));
  }, [accountId, target.adAccountId, dispatch]);

  // Fetch ad sets whenever the user picks a Meta campaign.
  useEffect(() => {
    if (!accountId || !target.adAccountId || !target.campaignId) return;
    dispatch(
      fetchAdsets({
        adAccountId: target.adAccountId,
        accountId,
        campaignId: target.campaignId,
      })
    );
  }, [accountId, target.adAccountId, target.campaignId, dispatch]);

  // Fetch Instant Forms for the picked Page — only when the campaign
  // objective is OUTCOME_LEADS (the only objective that supports lead ads).
  // Refetches on pageId OR campaignId change so the list always reflects
  // the current target. Forms are scoped to the Page on Meta's side; the
  // campaignId dep is included because the user explicitly asked the list
  // to refresh whenever the campaign changes.
  useEffect(() => {
    if (!isLeadsObjective || !target.pageId) return;
    dispatch(fetchLeadForms(target.pageId));
  }, [isLeadsObjective, target.pageId, target.campaignId, dispatch]);

  const patch = (partial) => onChange?.({ ...target, ...partial });

  const handleAdAccountChange = (adAccountId) => {
    // Reset the entire chain below ad account, including the captured
    // campaign objective (the new account's campaign list will replace it).
    // leadFormId is page-scoped, but the campaign change cascading from here
    // could move us off OUTCOME_LEADS — clear it to avoid stale values.
    patch({
      adAccountId,
      campaignId: null,
      campaignObjective: null,
      adSetId: [],
      leadFormId: null,
    });
  };
  const handleCampaignChange = (newCampaignId) => {
    // Look up the picked campaign in the dropdown response and snapshot
    // its objective onto the target. AutomationForm watches this field to
    // (a) dispatch fetchCtaOptions, (b) clear any stale CTA button.
    const picked = (campaignsDropdown || []).find((c) => c.id === newCampaignId);
    patch({
      campaignId: newCampaignId,
      campaignObjective: picked?.objective || null,
      adSetId: [],
      leadFormId: null,
    });
  };
  // adSetId is an ordered array — backend rotates through it when one ad set
  // hits the 50-ad limit. AdSetMultiSelect preserves insertion order.
  const handleAdSetChange = (adSetId) => patch({ adSetId });
  // Page change invalidates the Instant Form selection — forms are scoped
  // to a Page on Meta, so a different Page means a different form list.
  const handlePageChange = (pageId) => patch({ pageId, leadFormId: null });
  const handleLeadFormChange = (leadFormId) => patch({ leadFormId });

  const accountOptions = (adAccDropdown || []).map((a) => ({
    value: a.id,
    label: a.name + (a.currency ? ` · ${a.currency}` : ''),
  }));
  const campaignOptions = (campaignsDropdown || []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const adSetOptions = (adSetDropdown || []).map((s) => ({
    value: s.id,
    label: s.name,
  }));
  const pageOptions = (facebookPageDropDown || []).map((p) => ({
    value: p.id,
    label: p.name,
  }));
  const leadFormOptions = (leadFormsDropdown || []).map((f) => ({
    value: f.id,
    label: f.name,
  }));

  const selectedAdSetIds = Array.isArray(target.adSetId) ? target.adSetId : [];

  const noAccounts = !accountOptions.length;
  const noCampaigns = target.adAccountId && !campaignOptions.length;
  const noAdSets = target.campaignId && !adSetOptions.length;
  const noPages = !pageOptions.length;
  const noLeadForms = isLeadsObjective && target.pageId && !leadFormOptions.length;

  return (
    <section
      className={`flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/2 px-4 py-3 transition ${
        disabled ? 'pointer-events-none opacity-50' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-[#15DCFF]" />
          <h3 className="text-sm font-semibold text-white 2xl:text-base">
            Where to post
            <span className="ml-0.5 text-red-400">*</span>
          </h3>
        </div>
      </div>

      {/* In edit mode the PATCH endpoint only accepts targets.meta.adSetId,
          so the other four target fields are locked to prevent the user
          from making changes that would be silently dropped server-side. */}
      {/* All target fields stay editable in edit mode — the PATCH endpoint
          accepts the full meta target (see buildJobUpdatePayload). */}
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
        <Field
          label="Ad account"
          empty={noAccounts && 'No ad accounts found on this Meta user.'}
        >
          <InputCommonDropdown
            label="Select ad account"
            options={accountOptions}
            value={target.adAccountId || ''}
            onChange={handleAdAccountChange}
            disabled={disabled || noAccounts}
          />
        </Field>

        <Field
          label="Campaign"
          empty={
            !target.adAccountId
              ? 'Pick an ad account first.'
              : noCampaigns && 'No campaigns under this ad account yet.'
          }
        >
          <InputCommonDropdown
            label="Select campaign"
            options={campaignOptions}
            value={target.campaignId || ''}
            onChange={handleCampaignChange}
            disabled={disabled || !target.adAccountId || noCampaigns}
          />
        </Field>

        <Field
          label="Ad sets"
          empty={
            !target.campaignId
              ? 'Pick a campaign first.'
              : noAdSets
                ? 'No ad sets under this campaign yet.'
                : selectedAdSetIds.length > 1
                  ? `${selectedAdSetIds.length} selected — backend rotates when one fills up.`
                  : null
          }
        >
          <AdSetMultiSelect
            label="Select ad sets"
            options={adSetOptions}
            value={selectedAdSetIds}
            onChange={handleAdSetChange}
            disabled={disabled || !target.campaignId || noAdSets}
          />
        </Field>

        <Field
          label="Facebook page"
          empty={noPages && 'No Facebook pages linked to this account.'}
        >
          <InputCommonDropdown
            label="Select page"
            options={pageOptions}
            value={target.pageId || ''}
            onChange={handlePageChange}
            disabled={disabled || noPages}
          />
        </Field>

        {isLeadsObjective && (
          <Field
            label="Lead form"
            empty={
              !target.pageId
                ? 'Pick a Facebook page first.'
                : noLeadForms && 'No lead forms found on this page.'
            }
          >
            <InputCommonDropdown
              label="Select Lead Form"
              options={leadFormOptions}
              value={target.leadFormId || ''}
              onChange={handleLeadFormChange}
              disabled={disabled || !target.pageId || noLeadForms}
            />
          </Field>
        )}
      </div>

      {(noAccounts || noPages) && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <Inbox className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="text-xs text-amber-200/90">
            {noAccounts && (
              <p>No Meta ad accounts found. Open Meta Ads Manager to create one, then refresh.</p>
            )}
            {noPages && !noAccounts && (
              <p>
                No Facebook Pages are linked to this Meta user. Link a Page in Meta Business
                Settings, then refresh.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children, empty, lockedNote }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-[#AFAFAF]">{label}</label>
      {children}
      {empty && <span className="text-[11px] text-[#AFAFAF] italic">{empty}</span>}
      {lockedNote && (
        <span className="text-[11px] text-[#AFAFAF] italic">{lockedNote}</span>
      )}
    </div>
  );
}
