import SpinnerImage from '@/assets/layouts/ad-factory/spinner-loader.svg';

const bottomEffectImage =
  'https://res.cloudinary.com/dqfhpfeor/image/upload/v1764236938/bottom-effect_fluwi5.svg';

const GeneratingLoader = ({ progress = 50 }) => {
  return (
    <div className="backdrop-blur-100 fixed inset-0 z-[999999] flex flex-col bg-white/60 dark:bg-[#0D0D0D]/50">
      <div className="fixed -top-[38%] right-[2vw] z-[-1] h-[19vw] w-[19vw] rounded-full bg-[linear-gradient(90deg,_#0975F0_0%,_#28BCFC_27%,_#8FC8FB_51%,_#28BCFC_72%,_#0975F0_100%)] opacity-100 blur-[100px] 2xl:blur-[100px]"></div>
      <div className="flex min-h-screen flex-col items-center justify-center">
        {/* % TEXT */}
        {/* <p className="mb-10 text-2xl font-medium text-gray-500 dark:text-[#AFAFAF]">{progress}%</p> */}

        {/* SPINNER */}
        <img src={SpinnerImage} className="h-20 animate-spin" />

        {/* STATUS TEXT */}
        <p className="mt-10 text-2xl font-normal tracking-wide text-gray-500 dark:text-[#AFAFAF]">
          AI is generating script..
        </p>

        {/* SUB TEXT */}
        <p className="mt-9 text-xl text-gray-500 dark:text-[#AFAFAF]">This may take 20–30 secs</p>
      </div>
      <img src={bottomEffectImage} className="fixed inset-0 top-[20%] z-[-1] h-full w-screen" />
    </div>
  );
};

export default GeneratingLoader;
