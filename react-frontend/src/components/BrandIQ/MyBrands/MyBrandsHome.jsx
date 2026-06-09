import AddNewBrandDialog from '../Actions/AddNewBrandDialog';
import BrandCard from '../Cards/BrandCard';
import { useSelector } from 'react-redux';
import { Loader } from 'lucide-react';
import AddNewBrand from '../Actions/AddNewBrand';

const MyBrandsHome = () => {
  const { myBrands, loading } = useSelector((state) => state.brandIQTabs);

  return (
    <div className="mybrands_home_container h-full w-full lg:p-6 2xl:p-10">
      {loading ? (
        <div className="flex min-h-[55vh] w-full items-center justify-center">
          <Loader className="h-8 w-8 animate-spin text-gray-600" />
        </div>
      ) : (
        <>
          {Array.isArray(myBrands) && myBrands?.length > 0 ? (
            <div className="grid grid-cols-1 items-start gap-[25px] sm:grid-cols-2 lg:grid-cols-3 lg:gap-3 xl:grid-cols-3 2xl:grid-cols-4 2xl:gap-5">
              {myBrands?.map((brand) => (
                <BrandCard key={brand.id} brand={brand} />
              ))}
            </div>
          ) : (
            <div className="brands_new_container flex min-h-[55vh] w-full items-center justify-center 2xl:min-h-[60vh]">
              <div className="flex flex-col items-center justify-center space-y-3 p-6 text-center">
                <h2 className="text-lg font-medium text-gray-700 dark:text-[#AFAFAF]">No brands added yet</h2>
                <p className="max-w-xs text-sm text-gray-500 dark:text-[#AFAFAF]">
                  Add brands to monitor activity, track key metrics, and streamline brand
                  management.
                </p>
                <AddNewBrand />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MyBrandsHome;
