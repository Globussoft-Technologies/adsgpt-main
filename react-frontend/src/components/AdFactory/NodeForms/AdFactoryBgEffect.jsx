import React, { useEffect } from 'react';
// const bottomEffectImage =
//   'https://res.cloudinary.com/dqfhpfeor/image/upload/v1764236938/bottom-effect_fluwi5.svg';
import bottomEffectImage from '@/assets/layouts/ad-factory/bottom-effect.svg';

const AdFactoryBgEffect = ({ isGenerated = false, isHidden = false }) => {
  return (
    <>
      {!isHidden && (
        <>
          <div
            className={`${isGenerated ? 'z-[99]' : 'z-0'} fixed -top-[40%] right-[2vw] h-[19vw] w-[19vw] rounded-full bg-[linear-gradient(90deg,_#0975F0_0%,_#28BCFC_27%,_#8FC8FB_51%,_#28BCFC_72%,_#0975F0_100%)] opacity-70 dark:opacity-100 blur-[100px]`}
          />

          <img
            src={bottomEffectImage}
            className={`${isGenerated ? 'z-[99]' : 'z-0'} pointer-events-none fixed bottom-0 left-1/2 w-[120vw] -translate-x-1/2 opacity-40 xl:opacity-55 xl:top-[28%] xl:bottom-auto dark:xl:opacity-100`}
            alt=""
          />
        </>
      )}
    </>
  );
};

export default AdFactoryBgEffect;
