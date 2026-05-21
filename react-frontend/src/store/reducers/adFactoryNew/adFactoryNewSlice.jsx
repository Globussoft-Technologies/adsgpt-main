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
  fetchCampaign,
  fetchAdsets,
  fetchGoogleAdAccounts,
  fetchGoogleCampaigns,
  fetchGoogleAdGroups,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { emitWhenConnected } from '@/utils/socketEmitter';
import { createSlice } from '@reduxjs/toolkit';

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
        state.results = data.results || {};
        state.history = data.history || [];
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
        state.history = data;
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
