import React from 'react';

const CreateCardButton = ({ className = '' }) => {
  return (
    <span
      className={`mr-2 sm:mr-2 shrink-0 inline-flex items-center justify-center rounded-full bg-white/90 px-3.5 py-1 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur-sm border border-white/60 transition-all duration-200 ease-out scale-[0.9] hover:scale-[0.936] hover:-translate-y-0.5 hover:shadow-md hover:bg-white hover:text-slate-800 active:scale-[0.855] cursor-pointer select-none 2xl:px-4 2xl:py-1.5 2xl:text-sm ${className}`}
    >
      Create
    </span>
  );
};

export default CreateCardButton;
