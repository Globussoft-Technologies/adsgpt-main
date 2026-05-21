const StepContent = ({ title, children }) => {
  return (
    <div className="p-0 px-0.5">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="text-[13px] leading-relaxed">{children}</div>
    </div>
  );
};

export default StepContent;
