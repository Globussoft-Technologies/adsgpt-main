const CreativeSection = ({ title, action, children }) => (
  <div className="rounded-2xl bg-black/5 p-3 backdrop-blur-md dark:bg-white/5">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h4 className="text-base font-semibold text-gray-900 2xl:text-lg dark:text-white">{title}</h4>
      {action}
    </div>
    {children}
  </div>
);

export default CreativeSection;
