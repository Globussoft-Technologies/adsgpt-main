const CreativeSection = ({ title, children }) => (
  <div className="rounded-2xl bg-black/5 p-3 backdrop-blur-md dark:bg-white/5">
    <h4 className="mb-3 text-base font-semibold text-gray-900 2xl:text-lg dark:text-white">{title}</h4>
    {children}
  </div>
);

export default CreativeSection;
