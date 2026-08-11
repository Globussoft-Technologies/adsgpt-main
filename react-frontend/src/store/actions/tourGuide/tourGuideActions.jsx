import getCookies from '@/utils/getCookies';
import { createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

/**
 * checkUserExists
 *
 * Queries the MongoDB checkUserExists collection to determine whether the
 * user has previously completed onboarding.
 *
 * Returns:
 *  true  → user document exists in the collection → already onboarded
 *  false → user document does NOT exist           → new user, show onboarding
 */
export const checkUserExists = createAsyncThunk(
  'tourGuide/checkUserExists',
  async (userId, { rejectWithValue }) => {
    if (!userId) {
      // No userId yet — reject so hasChecked stays false and we wait
      return rejectWithValue('userId is required');
    }
    const token = getCookies();
    try {
      const response = await axios.post(
        `${BACKEND_HOST}/adsgpt/adcopy/check-user/${userId}`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const exists = Boolean(response?.data?.exists);
      // Always sync localStorage to match DB result — DB is the source of truth
      try {
        if (exists) {
          localStorage.setItem('adsgpt_onboarding_completed', 'true');
          localStorage.setItem(`onboarding_completed_${userId}`, 'true');
        } else {
          // DB says not onboarded (new user or record deleted) — clear stale cache
          localStorage.removeItem('adsgpt_onboarding_completed');
          localStorage.removeItem(`onboarding_completed_${userId}`);
        }
      } catch {
        // ignore storage errors
      }
      return exists;
    } catch (error) {
      console.error('Onboarding check failed:', error);
      return rejectWithValue(error.message);
    }
  }
);

/**
 * markUserOnboardingComplete
 *
 * Persists the user's onboarding completion to the MongoDB
 * checkUserExists collection (upsert). Called when the user finishes
 * or skips the tour so they are never shown it again.
 */
export const markUserOnboardingComplete = createAsyncThunk(
  'tourGuide/markUserOnboardingComplete',
  async (userId, { rejectWithValue }) => {
    if (!userId) return rejectWithValue('userId is required');

    // Immediately cache in localStorage so refreshes don't flicker
    try {
      localStorage.setItem('adsgpt_onboarding_completed', 'true');
      localStorage.setItem(`onboarding_completed_${userId}`, 'true');
    } catch {
      // ignore storage errors
    }

    const token = getCookies();
    try {
      const response = await axios.post(
        `${BACKEND_HOST}/adsgpt/adcopy/complete-onboarding/${userId}`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return response?.data?.success || true;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

/**
 * resetUserOnboarding
 *
 * Deletes the user onboarding record from MongoDB checkUserExists collection
 * and clears local storage flags so the onboarding tour is presented on next refresh.
 */
export const resetUserOnboarding = createAsyncThunk(
  'tourGuide/resetUserOnboarding',
  async (userId, { rejectWithValue }) => {
    if (!userId) return rejectWithValue('userId is required');

    try {
      localStorage.removeItem('adsgpt_onboarding_completed');
      localStorage.removeItem(`onboarding_completed_${userId}`);
    } catch {
      // ignore storage errors
    }

    const token = getCookies();
    try {
      const response = await axios.post(
        `${BACKEND_HOST}/adsgpt/adcopy/reset-onboarding/${userId}`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return response?.data?.success || true;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);
