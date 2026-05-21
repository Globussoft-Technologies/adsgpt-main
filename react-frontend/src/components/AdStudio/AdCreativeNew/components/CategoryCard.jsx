import { ChevronRight } from 'lucide-react';

export function CategoryCard({ category, onClick, className }) {
  return (
    <div
      id={`tour_ad-creative-card_${category.key}`}
      onClick={() => onClick?.(category.key)}
      className={`group relative h-full min-h-[180px] cursor-pointer overflow-hidden rounded-2xl 2xl:rounded-4xl ${
        className ?? ''
      }`}
    >
      <img
        src={category.defaultImage}
        alt={category.title.trim()}
        className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:opacity-0"
      />

      <img
        src={category.hoverImage}
        alt={`${category.title.trim()}-preview`}
        className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <div className="absolute inset-0 bg-[linear-gradient(0deg,#0f0f0f_10.93%,rgba(15,15,15,0)_84.92%)]" />

      <div className="absolute right-0 bottom-4 left-2 flex items-end justify-between transition duration-300 group-hover:-translate-y-2 sm:right-2 sm:left-4">
        <div>
          <h3 className="text-base font-bold tracking-wide sm:text-lg 2xl:text-[26px]">
            {category.title.trim()}
          </h3>
          {category.subtitle && (
            <p className="text-[10px] -mt-0.5 text-white/90 sm:text-xs 2xl:text-base">
              {category.subtitle.trim()}
            </p>
          )}
        </div>

        <div className="flex h-8 w-8 items-center justify-center rounded-full">
          <ChevronRight className="h-6.5 w-6.5 2xl:h-8 2xl:w-8" />
        </div>
      </div>
    </div>
  );
}
