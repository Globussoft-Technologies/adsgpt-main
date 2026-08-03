// Builds the request body for `postAdV2`. Pure function — no React
// state, no Redux — so the modal's submit handler stays a thin wrapper.
//
// Shape mirrors AdFactory/PostAd/FbAccountReady.jsx's launch payload,
// minus `adFactoryCampaignId` and `adFactoryCreativeId` (MySpace assets
// aren't tied to an AdFactory campaign — backend treats both as
// optional). `imageUrl` and `videoUrl` are mutually exclusive per the
// API spec — switched on the media's `isVideo` flag.
//
// `selection.accountId`/`selection.facebookId` come from the
// FacebookAccountSelector picked in MySpaceSelectStep — a user can have
// multiple Facebook accounts connected, so the account is no longer
// assumed from the single global `fbUser`.
export default function buildPostAdPayload({
  selection,
  media,
  form,
}) {
  const ad = {
    headline: form.headline,
    message: form.primaryText,
    description: form.description || '',
    linkUrl: form.linkUrl,
    callToAction: form.callToAction,
    adFactoryCreativeId:""
  };
  if (media?.isVideo) {
    ad.videoUrl = media.url;
  } else {
    ad.imageUrl = media.url;
  }

  return {
    accountId: selection.accountId,
    facebookId: selection.facebookId,
    adAccountId: selection.adAccountId,
    pageId: selection.pageId,
    campaignDetails: { campaignId: selection.campaignId },
    adFactoryCampaignId:"",
    adSetDetails: { adSetId: selection.adSetId },
    // Leads campaigns only — backend rejects with "Lead Form is
    // required" if a Leads campaign is posted without one.
    ...(selection.leadFormId ? { leadFormId: selection.leadFormId } : {}),
    ads: [ad],
  };
}
