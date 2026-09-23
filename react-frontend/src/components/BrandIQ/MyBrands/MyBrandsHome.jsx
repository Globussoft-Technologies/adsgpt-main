import AddNewBrandDialog from '../Actions/AddNewBrandDialog';
import BrandCard from '../Cards/BrandCard';
import { useDispatch, useSelector } from 'react-redux';
import { Loader } from 'lucide-react';
import AddNewBrand from '../Actions/AddNewBrand';
import Masonry from 'react-masonry-css';
import { useMemo } from 'react';
import { setMyBrandsSearch } from '@/store/reducers/brandIQ/brandIQTabsSlice';

const BRAND_GRID_BREAKPOINTS = {
  default: 5,
  1535: 4,
  1279: 3,
  1023: 2,
  639: 1,
};

const MyBrandsHome = () => {
  const dispatch = useDispatch();
  const { myBrands, myBrandsSearch, loading } = useSelector((state) => state.brandIQTabs);
  const filteredBrands = useMemo(() => {
    const query = myBrandsSearch.trim().toLocaleLowerCase();
    if (!query) return myBrands;

    return myBrands.filter((brand) => (brand?.name || '').toLocaleLowerCase().includes(query));
  }, [myBrands, myBrandsSearch]);

  return (
    <div className="mybrands_home_container flex h-full min-h-0 w-full flex-col pt-6 2xl:pt-10">
      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Loader className="h-8 w-8 animate-spin text-gray-600" />
        </div>
      ) : (
        <>
          {Array.isArray(myBrands) && myBrands.length > 0 ? (
            filteredBrands.length > 0 ? (
              <div className="brandiq-my-brands-grid-scroll min-h-0 flex-1 overflow-y-auto">
                <Masonry
                  breakpointCols={BRAND_GRID_BREAKPOINTS}
                  className="flex w-full gap-[25px] px-4 pb-6 md:px-8 lg:gap-3 2xl:px-10"
                  columnClassName="flex min-w-0 flex-col gap-[25px] lg:gap-3"
                >
                  {filteredBrands.map((brand) => (
                    <BrandCard key={brand.id} brand={brand} />
                  ))}
                </Masonry>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <h2 className="text-lg font-medium text-gray-700 dark:text-[#AFAFAF]">No brands found</h2>
                <p className="max-w-sm text-sm text-gray-500 dark:text-[#AFAFAF]">
                  No brand names match “{myBrandsSearch.trim()}”.
                </p>
                <button
                  type="button"
                  onClick={() => dispatch(setMyBrandsSearch(''))}
                  className="rounded-full border border-[var(--ws-border)] bg-[var(--ws-surface-control)] px-4 py-2 text-sm font-medium text-[var(--ws-text-primary)] transition-colors hover:bg-[var(--ws-surface-hover)] dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                >
                  Clear search
                </button>
              </div>
            )
          ) : (
            <div className="brands_new_container flex min-h-0 flex-1 items-center justify-center">
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
