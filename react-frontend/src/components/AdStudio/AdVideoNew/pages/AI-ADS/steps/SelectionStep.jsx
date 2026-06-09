import React, { useState } from 'react';
import { X } from 'lucide-react';
import adBrandImg from '@/assets/layouts/adVideoNew/adBrand.png';
import adProductImg from '@/assets/layouts/adVideoNew/adProduct.png';

const SelectionStep = ({ onNext, onBack, onClose }) => {
  const [selected, setSelected] = useState(''); // 'brand' or 'product'

  const handleNext = () => {
    if (selected) {
      onNext(selected, { baseType: selected });
    }
  };

  const handleDoubleClick = (type) => {
    setSelected(type);
    onNext(type, { baseType: type });
  };

  return (
    <div className="relative flex h-full w-screen rounded-3xl max-w-sm min-w-[450px] flex-col overflow-y-auto bg-white dark:bg-[#303030]/40 p-6 sm:max-w-xl md:max-w-2xl 2xl:max-h-[90vh] 2xl:max-w-4xl 2xl:p-12">
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
      <div className="mx-auto mb-10 flex w-full justify-center gap-2.5">
        {/* Brand Card */}
        <div
          onClick={() => setSelected('brand')}
          onDoubleClick={() => handleDoubleClick('brand')}
          className={`group relative aspect-5/6 w-full cursor-pointer overflow-hidden rounded-[20px] border-2 transition-all duration-200 ${
            selected === 'brand'
              ? 'border-white/40 shadow-[0_0_15px_rgba(255,255,255,0.1)]'
              : 'border-transparent hover:border-white/20'
          }`}
        >
          <img
            src={adBrandImg}
            alt="Brand"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

          <div className="absolute right-0 bottom-6 left-0 flex justify-center">
            <h3 className="text-xl font-bold tracking-wide text-white 2xl:text-2xl">Brand</h3>
          </div>
        </div>

        {/* Product Card */}
        <div
          onClick={() => setSelected('product')}
          onDoubleClick={() => handleDoubleClick('product')}
          className={`group relative aspect-5/6 w-full cursor-pointer overflow-hidden rounded-[20px] border-2 transition-all duration-200 ${
            selected === 'product'
              ? 'border-white/40 shadow-[0_0_15px_rgba(255,255,255,0.1)]'
              : 'border-transparent hover:border-white/20'
          }`}
        >
          <img
            src={adProductImg}
            alt="Product"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

          <div className="absolute right-0 bottom-6 left-0 flex justify-center">
            <h3 className="text-xl font-bold tracking-wide text-white 2xl:text-2xl">Product</h3>
          </div>
        </div>
      </div>

      {/* Footer Buttons */}
      <div className="flex w-full justify-end gap-3">
        {/* <button
          onClick={onBack}
          className="min-w-35 rounded-md border border-[#efefef] px-8 py-2 text-sm font-semibold text-white transition hover:bg-white/5"
        >
          Back
        </button> */}
        {/* <button
          onClick={handleNext}
          disabled={!selected}
          className={`min-w-35 rounded-md bg-white px-8 py-2 text-sm font-semibold text-black transition ${
            !selected ? 'cursor-not-allowed opacity-50' : 'hover:opacity-90'
          }`}
        >
          Next
        </button> */}
      </div>
    </div>
  );
};

export default SelectionStep;
