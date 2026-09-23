import React, { useEffect } from 'react';
import BrandIQHome from '@/components/BrandIQ/BrandIQHome';
import { useDispatch, useSelector } from 'react-redux';
import { fetchBrands } from '@/store/actions/brandIQ/myBrandActions';
import { setBrandIQLoading } from '@/store/reducers/brandIQ/brandIQTabsSlice';
import { useLocation, useNavigate } from 'react-router-dom';
import { setShowTour } from '@/store/reducers/tourGuide/tourGuideSlice';

const BrandIQPage = () => {
  const dispatch = useDispatch();
  const userData = useSelector((state) => state.socket.userData);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.state?.from == 'onBoard') {
      dispatch(setShowTour(true));
      navigate(location.pathname, { replace: true, state: {} });
    }
    if (userData?.user_id) {
      dispatch(fetchBrands(userData?.user_id));
    } else {
      dispatch(setBrandIQLoading(true));
    }
  }, [dispatch, navigate, userData?.user_id]);

  return (
    <div className="brand_iq_container flex h-full min-h-0 flex-1 overflow-hidden">
      <BrandIQHome />
    </div>
  );
};

export default BrandIQPage;
