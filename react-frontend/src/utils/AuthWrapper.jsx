import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { checkUserExists, openOnboarding } from '@/onboarding';
import getUserIdFromToken from '@/utils/getUserIdFromToken';

/**
 * AuthWrapper
 *
 * MongoDB is the single source of truth for onboarding status.
 * Always queries the DB on load. localStorage is only used as a write-through
 * cache — it is always overwritten to match the DB result.
 */
const AuthWrapper = ({ children }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { userExists, loading: userLoading, hasChecked } = useSelector(
    (state) => state.tourGuide
  );
  const { userData } = useSelector((state) => state.socket);

  const userId = userData?.user_id || getUserIdFromToken();

  // Prevents firing the onboarding decision more than once per session.
  const onboardingTriggeredRef = useRef(false);

  // ── Step 1: Always query DB on mount / userId change ──
  useEffect(() => {
    if (userId) {
      onboardingTriggeredRef.current = false;
      dispatch(checkUserExists(userId));
    }
  }, [dispatch, userId]);

  // ── Step 2: Act on DB result — DB wins over localStorage ──
  useEffect(() => {
    if (!userId) return;
    if (!hasChecked || userLoading) return;
    if (onboardingTriggeredRef.current) return;

    onboardingTriggeredRef.current = true;

    if (userExists) {
      // DB confirms onboarded — redirect away if somehow on /onboarding
      if (window.location.pathname === '/onboarding') {
        navigate('/adstudio', { replace: true });
      }
    } else {
      // DB says NOT onboarded (new user or record deleted) — show onboarding
      dispatch(openOnboarding());
    }
  }, [hasChecked, userLoading, userId, userExists, dispatch, navigate]);

  return children;
};

export default AuthWrapper;
