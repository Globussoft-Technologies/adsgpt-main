import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import getCookies from '@/utils/getCookies';

const ADS_HOST = (
  import.meta.env.VITE_ADS_URL || 'https://adsgpt-dev-ads-api.poweradspy.com'
).trim();

/**
 * Fetches competitor ads — no-arg thunk, reads everything from Redux state.
 *
 * This mirrors fetchExploreAds in adCreativeActions exactly:
 *  - from     ← competitorSearch.skip    (same as adCreative.exploreSkip)
 *  - search   ← competitorSearch.searchTerm  (same as adCreative.exploreCompetitor)
 *  - type     ← competitorSearch.searchType  (same as adCreative.exploreSearchTerm)
 *
 * IMPORTANT: always dispatch setSearchTerm / setSearchType to Redux BEFORE dispatching
 * this thunk so that scroll fetches pick up the right values from state.
 */
export const fetchCompetitorAds = createAsyncThunk(
  'competitorSearch/fetchCompetitorAds',
  async (_, { rejectWithValue, getState }) => {
    try {
      const { competitorSearch, socket } = getState();
      const token = getCookies();

      const res = await axios.post(
        `${ADS_HOST}/ads/explore-ads`,
        {
          from: competitorSearch?.skip ?? 0,
          size: 10,
          networks: socket?.userData?.featureObject?.Networks || [],
          popularity: socket?.userData?.featureObject?.['Popularity Index'],
          type: 'IMAGE',
          user_id: socket?.userData?.user_id,
          competitor: competitorSearch?.searchTerm ? [competitorSearch.searchTerm] : [],
          platform: [],
          categories: [],
          searchType: competitorSearch?.searchType || 'competitor',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const ads = res?.data?.ads?.filter(Boolean) || [];

      return { ads };
    } catch (err) {
      return rejectWithValue(err.response?.data || err.message);
    }
  }
);
