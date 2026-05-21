import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Loader } from 'lucide-react';
import { checkUserExists } from '@/store/actions/tourGuide/tourGuideActions';
import { setShowTour } from '@/store/reducers/tourGuide/tourGuideSlice';

const AuthWrapper = ({ children }) => {
  const { userExists, loading: userLoading, showTour } = useSelector((state) => state.tourGuide);
  const { userData } = useSelector((state) => state.socket);
  const [hasAutoShowed, setHasAutoShowed] = useState(false);
  const navigate = useNavigate();
  const userId = userData?.user_id;
  const dispatch = useDispatch();

  useEffect(() => {
    if (userId) dispatch(checkUserExists(userId));
  }, [dispatch, userId]);

  useEffect(() => {
    // if (!userLoading && userData?.user_id && !userExists && !showTour && !hasAutoShowed) {
    //   dispatch(setShowTour(true));
    //   setHasAutoShowed(true);
    // }

    if (!userLoading && userExists && window.location.pathname === '/onboarding') {
      navigate('/adstudio', { replace: true });
    }
  }, [userExists, userLoading, userData?.user_id, navigate, dispatch, showTour, hasAutoShowed]);

  // Show loader while checking authentication status
  if (userLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-gray-600" />
      </div>
    );
  }

  return children;
};

export default AuthWrapper;
