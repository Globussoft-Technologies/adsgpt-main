import MyBrandsHome from './MyBrands/MyBrandsHome';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import CompetitorsHome from './Competitors/CompetitorsHome';
import Gallery from './SavedItems/Gallery';
import { setActiveBrandIQTab } from '@/store/reducers/brandIQ/brandIQTabsSlice';
import { canUseWorkspaceFeature } from '@/utils/workspaceSession';

const BrandIQHome = () => {
  const dispatch = useDispatch();
  const activeBrandIQTabId = useSelector((state) => state.brandIQTabs.activeBrandIQTabId);
  const allowedTabs = [
    canUseWorkspaceFeature('brandIq.myBrands') && 'myBrands',
    canUseWorkspaceFeature('brandIq.competitors') && 'competitors',
  ].filter(Boolean);
  const effectiveTabId = allowedTabs.includes(activeBrandIQTabId)
    ? activeBrandIQTabId
    : allowedTabs[0];

  useEffect(() => {
    if (effectiveTabId && effectiveTabId !== activeBrandIQTabId) {
      dispatch(setActiveBrandIQTab(effectiveTabId));
    }
  }, [activeBrandIQTabId, dispatch, effectiveTabId]);

  return (
    <div className="flex w-full flex-1 flex-col">
      {/* Show Visible Cards Here */}
      {effectiveTabId === 'myBrands' && <MyBrandsHome />}
      {effectiveTabId === 'Gallery' && <Gallery />}
      {effectiveTabId === 'competitors' && <CompetitorsHome />}
    </div>
  );
};

export default BrandIQHome;
