import React from 'react';
import { useSelector } from 'react-redux';
import AddieFullImage from '@/assets/layouts/addie-full-image.svg';

const AdCreativeWelcome = () => {
  const { userData } = useSelector((state) => state.socket);
  return (
    <div className="xxl:scale-75 flex h-[65vh] w-full scale-100 flex-col items-center justify-center p-4 sm:scale-75 2xl:h-[70vh] 2xl:scale-90">
      {/* Title Outside */}
      <h1 className="mb-5 bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-2xl font-semibold text-transparent sm:mb-6 sm:text-3xl 2xl:mb-10 2xl:text-4xl">
        Hello, {userData?.user_name}
      </h1>

      {/* Card Container */}
      <div className="flex items-center justify-center">
        <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-white/10 p-[1px]">
          <div className="flex flex-col items-center justify-center bg-[#0D0D0D]/50 p-2 pb-4 text-center backdrop-blur-[100px]">
            <img src={AddieFullImage} alt="Welcome" className="h-52 w-auto sm:h-full" />

            <p className="max-w-full text-xs leading-relaxed font-normal text-[#BEBEBE] sm:text-[16px]">
              Create scroll-stopping ads in seconds with AI that understands your business.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdCreativeWelcome;
