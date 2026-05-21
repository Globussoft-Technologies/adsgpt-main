const CreativeSection = ({ title, children }) => (
  <div className="rounded-2xl bg-white/5 p-3 backdrop-blur-md">
    <h4 className="mb-3 text-base font-semibold text-white 2xl:text-lg">{title}</h4>
    {children}
  </div>
);

export default CreativeSection;
