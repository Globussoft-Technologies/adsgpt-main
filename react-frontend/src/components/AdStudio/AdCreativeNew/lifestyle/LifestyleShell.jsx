import { ChevronLeft } from 'lucide-react';

export function LifestyleShell({ title = 'Lifestyle Ads', onClose, children }) {
  return (
    <div className="relative flex h-[calc(100svh-16px)] w-full flex-col overflow-hidden text-gray-900 dark:text-white">
      {/* <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[20%] left-[-10%] h-[80vmin] w-[80vmin] rounded-full bg-[linear-gradient(332.23deg,#15dcff_29.66%,#5e66f5_74.52%)] opacity-25 blur-[140px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[20%] right-[-5%] h-[36vmin] w-[36vmin] rounded-full bg-[linear-gradient(332.23deg,#15dcff_29.66%,#5e66f5_74.52%)] opacity-40 blur-[80px]"
      /> */}

      <div className="relative flex items-center gap-2 p-4 text-gray-900 dark:text-white">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 text-xl 2xl:text-3xl"
          >
            <ChevronLeft className="mt-1 h-6.5 w-6.5 2xl:h-9 2xl:w-9" />
            {title}
          </button>
        ) : (
          <h2 className="flex items-center gap-2 text-xl 2xl:text-3xl">{title}</h2>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-7 sm:px-8 md:px-10 md:pb-9 lg:px-[60px] lg:pb-[41px]">
        <div className="flex scale-75 2xl:scale-100 flex-1 flex-col items-center">
          <div className="m-auto flex w-full justify-center py-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
