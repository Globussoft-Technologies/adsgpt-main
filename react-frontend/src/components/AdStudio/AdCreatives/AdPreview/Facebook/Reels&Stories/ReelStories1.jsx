import { MoreVertical } from 'lucide-react';

function ReelStories1({ adCreativesData }) {
  return (
    <div className="w-full overflow-hidden rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="relative flex items-center justify-between bg-gradient-to-t from-black/0 to-black/70 p-2 py-3">
        <div className="flex items-center gap-1 text-white">
          {adCreativesData?.isValidPostOwnerImage ? (
            <img src={adCreativesData?.postOwnerImage} className="h-7 w-7 rounded-full" alt="" />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-600 text-xs leading-none font-bold text-white uppercase">
              {adCreativesData?.postOwnerImage}
            </div>
          )}
          <div>
            <p className="text-10 2xl:text-xs">{adCreativesData?.postOwner}</p>
            <p className="text-[9px] font-light">Sponsored</p>
          </div>
        </div>
        <button className="flex items-center justify-center">
          <MoreVertical className="h-3 w-3 text-gray-100" />
        </button>
      </div>

      {/* Image */}
      <div className="flex min-h-64 items-center justify-center">
        <img src={adCreativesData?.image} alt="Ad creative" className="w-full" />
      </div>

      {/* Fake Loading Bar */}
      <div className="flex animate-pulse flex-col items-center py-2.5">
        <div className="h-2 w-1/2 rounded-full bg-slate-400"></div>
      </div>
    </div>
  );
}

export default ReelStories1;
