import React, { useState } from 'react';
import { X } from 'lucide-react';
import adBrandImg from '@/assets/layouts/adVideoNew/adBrand.png';
import adProductImg from '@/assets/layouts/adVideoNew/adProduct.png';

const SelectionStep = ({ onNext, onBack, onClose }) => {
  const [selected, setSelected] = useState(''); // 'brand' or 'product'

  const handleSelect = (type) => {
    setSelected(type);
    onNext(type, { baseType: type });
  };

  return (
    <div className="scrollbar-hide relative flex h-full w-screen max-w-sm min-w-[450px] flex-col overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden p-6 sm:max-w-xl md:max-w-2xl 2xl:max-h-[90vh] 2xl:max-w-4xl 2xl:p-12">
      {/* Header */}
      <div className="relative mb-10 flex items-center justify-center pt-6 text-gray-900 dark:text-white 2xl:mb-12">
        <h2 className="text-base font-semibold sm:text-lg lg:text-xl 2xl:text-[26px]">
          Create an AI Ad for a Brand or Product
        </h2>
      </div>
      <button
        onClick={onClose}
        className="absolute top-3 right-3 rounded-full p-2 text-gray-500 dark:text-white/50 transition hover:bg-black/5 dark:hover:bg-white/10 hover:text-black dark:hover:text-white"
      >
        <X className="h-5 w-5 2xl:h-6 2xl:w-6" />
      </button>

      {/* Cards */}
      <div className="mx-auto mb-6 flex w-full justify-center gap-3 sm:gap-4">
        {/* Brand Card */}
        <div
          onClick={() => handleSelect('brand')}
          className={`group relative aspect-5/6 w-full cursor-pointer overflow-hidden rounded-[20px] border transition-all duration-300 ease-out hover:-translate-y-1 active:scale-[0.99] ${
            selected === 'brand'
              ? 'border-[#5867EB] dark:border-white ring-2 ring-[#5867EB]/30 dark:ring-white/30 shadow-[0_12px_30px_rgba(88,103,235,0.25)] dark:shadow-[0_12px_30px_rgba(255,255,255,0.15)] -translate-y-1'
              : 'border-[var(--ws-border)] dark:border-white/10 hover:border-[#5867EB]/60 dark:hover:border-white/30 hover:shadow-xl'
          }`}
        >
          <img
            src={adBrandImg}
            alt="Brand"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent transition-opacity duration-300 group-hover:opacity-95" />

          <div className="absolute right-0 bottom-6 left-0 flex justify-center">
            <h3 className="text-xl font-bold tracking-wide text-white transition-transform duration-300 group-hover:scale-105 2xl:text-2xl">
              Brand
            </h3>
          </div>
        </div>

        {/* Product Card */}
        <div
          onClick={() => handleSelect('product')}
          className={`group relative aspect-5/6 w-full cursor-pointer overflow-hidden rounded-[20px] border transition-all duration-300 ease-out hover:-translate-y-1 active:scale-[0.99] ${
            selected === 'product'
              ? 'border-[#5867EB] dark:border-white ring-2 ring-[#5867EB]/30 dark:ring-white/30 shadow-[0_12px_30px_rgba(88,103,235,0.25)] dark:shadow-[0_12px_30px_rgba(255,255,255,0.15)] -translate-y-1'
              : 'border-[var(--ws-border)] dark:border-white/10 hover:border-[#5867EB]/60 dark:hover:border-white/30 hover:shadow-xl'
          }`}
        >
          <img
            src={adProductImg}
            alt="Product"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent transition-opacity duration-300 group-hover:opacity-95" />

          <div className="absolute right-0 bottom-6 left-0 flex justify-center">
            <h3 className="text-xl font-bold tracking-wide text-white transition-transform duration-300 group-hover:scale-105 2xl:text-2xl">
              Product
            </h3>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SelectionStep;
