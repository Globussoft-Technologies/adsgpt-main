export function LifestyleShell({ title = 'Lifestyle Ads', children }) {
  return (
    <div className="relative flex h-[calc(100svh-16px)] w-full flex-col overflow-hidden text-[#1F1D29] dark:text-white">
      <div className="relative flex items-center gap-2 p-4 text-[#1F1D29] dark:text-white">
        <h2 className="flex items-center gap-2 text-xl 2xl:text-2xl font-medium">{title}</h2>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 sm:px-6 md:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="m-auto flex w-full justify-center py-2">{children}</div>
      </div>
    </div>
  );
}
