import MyBrandsHome from './MyBrands/MyBrandsHome';
import { useSelector } from 'react-redux';
import CompetitorsHome from './Competitors/CompetitorsHome';
import Gallery from './SavedItems/Gallery';

const BrandIQHome = () => {
  const activeBrandIQTabId = useSelector((state) => state.brandIQTabs.activeBrandIQTabId);

  return (
    <div className="flex w-full flex-1 flex-col">
      {/* Show Visible Cards Here */}
      {activeBrandIQTabId === 'myBrands' && <MyBrandsHome />}
      {activeBrandIQTabId === 'Gallery' && <Gallery />}
      {activeBrandIQTabId === 'competitors' && <CompetitorsHome />}
    </div>
  );
};

export default BrandIQHome;
