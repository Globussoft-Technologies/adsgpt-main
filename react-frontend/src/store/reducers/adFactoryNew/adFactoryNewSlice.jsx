import {
  Analyzingsweburl,
  checkFbUser,
  checkGoogleUser,
  disconnectGoogleUser,
  createCampaign,
  fetchAdFactoryHistory,
  fetchCampaignById,
  fetchCampaigns,
  updateCampaign,
  fetchAdAccounts,
  fetchFacebookPages,
  fetchLeadForms,
  fetchCampaign,
  fetchAdsets,
  fetchGoogleAdAccounts,
  fetchGoogleCampaigns,
  fetchGoogleAdGroups,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { emitWhenConnected } from '@/utils/socketEmitter';
import { createSlice } from '@reduxjs/toolkit';

// The /campaign/get response packs both manual and automation-generated
// artifacts into the same `results.image|text|video` arrays. We strip two
// kinds of items so the manual preview only shows the user's own real
// results:
//   1. Anything with a `jobId` — produced by an Autopilot scheduled run.
//   2. Anything without a meaningful `status` — placeholders the backend
//      persisted mid-run (status: null) or that were orphaned by a
//      partial worker failure. These would otherwise render as forever-
//      "Generating" purple spheres in AdCreativeList because the listener
//      only flips them to 200/400 when a matching socket event arrives,
//      and on a cold page load that event has long since passed.
// `initializeResults` (called only from manual ServicesForm) writes
// placeholders directly to in-memory state AFTER this hydration runs, so
// stripping nulls here doesn't break live manual generation — the active
// run's slots are re-seeded by initializeResults a tick later.
const MEANINGFUL_STATUSES = new Set([200, 400]);
const isManualResultItem = (item) =>
  !item?.jobId && MEANINGFUL_STATUSES.has(Number(item?.status));

const filterManualResults = (results) => {
  if (!results || typeof results !== 'object') return {};
  return {
    ...results,
    image: Array.isArray(results.image) ? results.image.filter(isManualResultItem) : [],
    text: Array.isArray(results.text) ? results.text.filter(isManualResultItem) : [],
    video: Array.isArray(results.video) ? results.video.filter(isManualResultItem) : [],
  };
};

// Re-hydrating from the server strips any `status: null` placeholders the
// client seeded via `initializeResults`. When the hydration runs mid-
// generation (e.g. AdsPreviewDialog mount), we need to preserve those
// pending slots so the dialog keeps showing skeletons and the next socket
// result lands in a slot instead of getting silently dropped.
//
// Strategy: trust the server for completed items, then pad with as many
// fresh placeholders as the client expected but the server hasn't filled
// yet. If the server has caught up, padding is 0 — no extra slots.
const makePendingItem = () => ({
  status: null,
  data: '',
  error: null,
  timestamp: new Date().toISOString(),
});
const mergeWithPending = (prevArr, serverArr, minPending = 0) => {
  const expected = Array.isArray(prevArr) ? prevArr.length : 0;
  const completed = Array.isArray(serverArr) ? serverArr : [];
  // `expected - completed.length` re-seeds slots the client already knew about
  // (live socket run). `minPending` re-seeds slots the server still reports as
  // pending — the only signal available on a cold refresh where the client has
  // no prior state to pad from.
  const needed = Math.max(0, expected - completed.length, minPending);
  if (needed === 0) return completed;
  return [...completed, ...Array.from({ length: needed }, makePendingItem)];
};

// On a cold refresh that lands mid-generation, the client has no prior slots to
// pad from, so `filterManualResults` strips the server's `status: null`
// placeholders and the skeletons vanish until a socket event arrives (which, on
// a fresh load, may have already passed). Count the server's own pending manual
// (non-jobId, non-final-status) slots so we can re-seed them while the campaign
// is still in-progress.
const countServerPending = (arr) =>
  Array.isArray(arr)
    ? arr.filter((item) => !item?.jobId && !MEANINGFUL_STATUSES.has(Number(item?.status))).length
    : 0;

// Each history snapshot under `state.history` carries its own frozen copy of
// the campaign's results in `previousData.results`. AdCreativeList's History
// tab reads from THAT nested array — not from `state.results` — so we have to
// run the same manual-vs-automation strip on every snapshot too. Otherwise
// the History grid shows every automation run's images even though the
// Current Images grid above it is already filtered.
const filterManualHistory = (history) => {
  if (!Array.isArray(history)) return [];
  return history.map((item) => {
    if (!item?.previousData?.results) return item;
    return {
      ...item,
      previousData: {
        ...item.previousData,
        results: filterManualResults(item.previousData.results),
      },
    };
  });
};

const initialState = {
  metaData: {},
  brandInfo: {},
  objectives: {},
  assets: {},
  distribution: {},
  productionAndServices: {},
  results: {},
  firstAdCopies: [],
  availablefirstImages: [],
  campaigns: [],
  activeCampaign: [],
  activeCampainId: '',
  loading: false,
  urldataloading: false,
  error: null,
  showFlowChart: false,
  brand_logo: '',
  brand_name: '',
  brand_description: '',
  selectedBrand: {},
  history: {},
  deleteCampaignId: '',
  deleteDialogOpen: false,
  fbUser: null,
  googleUser: null,
  adAccDropdown: [],
  facebookPageDropDown: [],
  campaignsDropdown: [],
  adSetDropdown: [],
  leadFormsDropdown: [],
  adsDialogType: false,
  adsDialogOpen: false,
  enableId: true,
  adCreatives: [
    {
      id: '1',
      name: 'Ad Creative 1',
      image: '',
      text: [],
      cta: '',
      ctaLink: null,
      createdAt: '',
    },
  ],
  postnodecreatives: [],
  googleAdAccounts: [],
  googleCampaigns: [],
  googleAdGroups: [],
};

const adFactoryNewSlice = createSlice({
  name: 'adFactoryNew',
  initialState,
  reducers: {
    setDeleteCampaignId: (state, action) => {
      state.deleteCampaignId = action.payload;
    },
    setDeleteDialogOpen: (state, action) => {
      state.deleteDialogOpen = action.payload;
    },
    setShowFlowChart: (state, action) => {
      state.showFlowChart = action.payload;
    },
    setAdsDialogType: (state, action) => {
      state.adsDialogType = action.payload;
    },
    setAdsDialogOpen: (state, action) => {
      state.adsDialogOpen = action.payload;
    },
    setFirstAdCopies: (state, action) => {
      state.firstAdCopies = action.payload;
    },
    setAvailablefirstImages: (state, action) => {
      state.availablefirstImages = action.payload;
    },
    setEnableId: (state, action) => {
      state.enableId = action.payload;
    },

    updateHistory: (state, action) => {
      state.history = action.payload;
    },
    updateAdCreatives: (state, action) => {
      state.adCreatives = action.payload;
    },
    updateCampaignSession: (state, action) => {
      state.activeCampainId = action.payload;
    },
    updateMetaData: (state, action) => {
      state.metaData = action.payload;
    },
    updateBrandInfo: (state, action) => {
      state.brandInfo = action.payload;
    },
    updateBrandName: (state, action) => {
      state.brandInfo = { ...state.brandInfo, brandName: action.payload.brandName };
    },
    updateObjectives: (state, action) => {
      state.objectives = action.payload;
    },
    updateAssets: (state, action) => {
      state.assets = action.payload;
    },
    updateDistribution: (state, action) => {
      state.distribution = action.payload;
    },
    updateProductionAndServices: (state, action) => {
      state.productionAndServices = action.payload;
    },

    updateCampaigns: (state, action) => {
      state.campaigns = action.payload;
    },
    updateActiveCampaign: (state, action) => {
      state.activeCampaign = action.payload;
    },

    updateResults: (state, action) => {
      const responseData = action.payload;

      if (!responseData?.type || !responseData?.result?.length) return;

      const list = responseData.result; // multiple results

      if (responseData.type == 'image') {
        list.forEach((item) => {
          const index = state.results.image.findIndex((img) => !img.status);

          if (index !== -1) {
            state.results.image[index] = {
              ...state.results.image[index],
              ...item,
              timestamp: new Date().toISOString(),
            };
          }
        });
      }

      if (responseData.type == 'text') {
        list.forEach((item) => {
          const index = state.results.text.findIndex((text) => !text.status);

          if (index !== -1) {
            state.results.text[index] = {
              ...state.results.text[index],
              ...item,
              timestamp: new Date().toISOString(),
            };
          }
        });
      }

      if (responseData.type == 'video') {
        list.forEach((item) => {
          const index = state.results.video.findIndex((vid) => !vid.status);

          if (index !== -1) {
            state.results.video[index] = {
              ...state.results.video[index],
              ...item,
              timestamp: new Date().toISOString(),
            };
          }
        });
      }
      const allDone = ['image', 'text', 'video'].every((t) => {
        const arr = state.results[t];
        if (!arr?.length) return true;
        return arr?.every((item) => item?.status);
      });

      if (allDone) {
        state.results.status = 'success';
      }
    },

    initializeResults: (state, action) => {
      const { type, quantity } = action.payload;

      if (!state.results) {
        state.results = {
          type: 'result',
          status: 'draft',
          text: [],
          image: [],
          video: [],
        };
      }

      const defaultItem = () => ({
        status: null,
        data: '',
        error: null,
        timestamp: new Date().toISOString(),
      });

      if (type == 'image') {
        console.log('quantity', quantity);
        // state.results.image = Array.from({ length: quantity },defaultItem);
        state.results.image = Array.from({ length: quantity }, () => defaultItem());
      }

      if (type == 'text') {
        state.results.text = Array.from({ length: quantity }, () => defaultItem());
      }

      if (type == 'video') {
        state.results.video = Array.from({ length: quantity }, () => defaultItem());
      }
    },

    setFields: (state, action) => {
      Object.entries(action.payload).forEach(([key, value]) => {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
          state[key] = value;
        }
      });
    },
    removePostNodeCreative: (state, action) => {
      const creativeId = action.payload;

      state.postnodecreatives = state.postnodecreatives.filter(
        (creative) => creative.creativeId !== creativeId
      );
    },

    clearFbUser: (state) => {
      state.fbUser = null;
    },

    //reset all
    resetAdFactorNewSlice: () => ({ ...initialState }),
  },
  extraReducers: (builder) => {
    builder
      .addCase(createCampaign.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createCampaign.fulfilled, (state, action) => {
        state.activeCampainId = action?.payload;
        emitWhenConnected('adFactoryRequest', state.activeCampainId);
        state.brandInfo = {};
        state.objectives = {};
        state.assets = {};
        state.distribution = {};
        state.productionAndServices = {};
        state.results = {};
        // IMPORTANT: clear any previous campaign creative data (CTA link etc.)
        state.adCreatives = [...initialState.adCreatives];
        state.postnodecreatives = [];
        state.firstAdCopies = [];
        state.availablefirstImages = [];
        state.history = {};
        state.enableId = true;
        state.selectedBrand = {};
        state.loading = false;
        state.brand_logo = '';
        state.brand_name = '';
        state.brand_description = '';
      })
      .addCase(createCampaign.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(Analyzingsweburl.pending, (state) => {
        state.urldataloading = true;
        state.error = null;
      })
      .addCase(Analyzingsweburl.fulfilled, (state, action) => {
        state.brandInfo = action?.payload?.brandInfo || {};
        state.objectives = action?.payload?.objectives || {};
      })
      .addCase(Analyzingsweburl.rejected, (state, action) => {
        state.urldataloading = false;
        state.error = action.payload;
      })
      .addCase(updateCampaign.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateCampaign.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(updateCampaign.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchCampaigns.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCampaigns.fulfilled, (state, action) => {
        state.campaigns = action?.payload;
        state.loading = false;
      })
      .addCase(fetchCampaigns.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchCampaignById.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCampaignById.fulfilled, (state, action) => {
        const data = action.payload;

        state.metaData = data.metadata || {};
        state.brandInfo = data.brandInfo || {};
        state.objectives = data.objectives || {};
        state.assets = data.assets || {};
        state.distribution = data.distribution || {};
        state.productionAndServices = data.services || {};
        // Strip out automation-generated artifacts before they hydrate the
        // manual preview. The /campaign/get endpoint returns every image/text
        // produced under this campaign — including ones generated by Autopilot
        // scheduled runs, which carry a `jobId`. Manual artifacts have
        // `jobId == null`. Automation results have their own view (the Posted
        // Ads modal driven by /autopilot/jobs/:id/activity), so leaking them
        // here would double-show them in the manual Current Images grid.
        //
        // Pad with the in-flight placeholders the client had before this
        // hydration ran. `fetchCampaignById` is dispatched from places other
        // than ServicesForm (e.g. AdsPreviewDialog mount), where there's no
        // follow-up `initializeResults` to re-seed slots — without this
        // merge, navigating to Prepare Creatives mid-generation wipes the
        // pending `{status: null}` slots and the subsequent socket result
        // gets dropped by `updateResults` (no `!status` slot to fill).
        const serverResults = filterManualResults(data.results);
        const prevResults = state.results || {};
        // Only re-seed the server's pending placeholders while generation is
        // genuinely running. Once the campaign is done, leftover `status: null`
        // items are orphaned (partial worker failure) and must stay stripped so
        // they don't render as forever-"Generating" spheres.
        const isInProgress =
          data?.status === 'in-progress' || data?.results?.status === 'in-progress';
        state.results = {
          ...serverResults,
          text: mergeWithPending(
            prevResults.text,
            serverResults.text,
            isInProgress ? countServerPending(data?.results?.text) : 0
          ),
          image: mergeWithPending(
            prevResults.image,
            serverResults.image,
            isInProgress ? countServerPending(data?.results?.image) : 0
          ),
          video: mergeWithPending(
            prevResults.video,
            serverResults.video,
            isInProgress ? countServerPending(data?.results?.video) : 0
          ),
        };
        state.history = filterManualHistory(data.history);
        state.activeCampaign = data;
        state.loading = false;
        state.postnodecreatives = data.creatives || [];
      })
      .addCase(fetchCampaignById.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(fetchAdFactoryHistory.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchAdFactoryHistory.fulfilled, (state, action) => {
        const data = action.payload;
        state.loading = false;
        state.history = filterManualHistory(data);
      })
      .addCase(fetchAdFactoryHistory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });

    builder.addCase(checkFbUser.fulfilled, (state, action) => {
      state.fbUser = action.payload ?? null;
    });
    builder.addCase(checkFbUser.rejected, (state) => {
      state.fbUser = null;
    });
    builder.addCase(checkGoogleUser.fulfilled, (state, action) => {
      state.googleUser = action.payload ?? null;
    });
    builder.addCase(checkGoogleUser.rejected, (state) => {
      state.googleUser = null;
    });
    builder.addCase(disconnectGoogleUser.fulfilled, (state) => {
      state.googleUser = null;
    });
    builder.addCase(fetchAdAccounts.fulfilled, (state, action) => {
      const data = action.payload;
      state.adAccDropdown = data;
    });

    builder.addCase(fetchFacebookPages.fulfilled, (state, action) => {
      const data = action.payload;
      state.facebookPageDropDown = data;
    });

    builder.addCase(fetchCampaign.fulfilled, (state, action) => {
      const data = action.payload;
      state.campaignsDropdown = data;
    });

    builder.addCase(fetchAdsets.fulfilled, (state, action) => {
      const data = action.payload;
      state.adSetDropdown = data;
    });

    builder.addCase(fetchLeadForms.fulfilled, (state, action) => {
      state.leadFormsDropdown = action.payload || [];
    });

    builder.addCase(fetchGoogleAdAccounts.fulfilled, (state, action) => {
      state.googleAdAccounts = action.payload;
    });
    builder.addCase(fetchGoogleCampaigns.fulfilled, (state, action) => {
      state.googleCampaigns = action.payload;
    });
    builder.addCase(fetchGoogleAdGroups.fulfilled, (state, action) => {
      state.googleAdGroups = action.payload;
    });
  },
});

export const {
  updateMetaData,
  updateBrandInfo,
  updateObjectives,
  updateAssets,
  updateDistribution,
  updateProductionAndServices,
  updateCampaigns,
  updateActiveCampaign,
  updateResults,
  initializeResults,
  setShowFlowChart,
  setFields,
  updateBrandName,
  setDeleteCampaignId,
  updateHistory,
  setDeleteDialogOpen,
  updateAdCreatives,
  setAdsDialogType,
  setAdsDialogOpen,
  setFirstAdCopies,
  setAvailablefirstImages,
  setEnableId,
  removePostNodeCreative,
  resetAdFactorNewSlice,
  clearFbUser,
} = adFactoryNewSlice.actions;

export default adFactoryNewSlice.reducer;
