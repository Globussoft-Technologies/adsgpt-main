import { useState } from 'react';
import { FaPlay } from 'react-icons/fa6';

export const AdVideoList = () => {
  const [selected, setSelected] = useState(0);

  const adVideos = [
    {
      title: 'Ad Video 1',
      description:
        'Create scroll-stopping ads in seconds with AI that understands your brand, your audience',
      image: 'https://i.ibb.co/n87DPjzS/advideo-card.png',
    },
    {
      title: 'Ad Video 2',
      description:
        'Create scroll-stopping ads in seconds with AI that understands your brand, your audience',
      image: 'https://i.ibb.co/n87DPjzS/advideo-card.png',
    },
    {
      title: 'Ad Video 3',
      description:
        'Create scroll-stopping ads in seconds with AI that understands your brand, your audience',
      image: 'https://i.ibb.co/n87DPjzS/advideo-card.png',
    },
  ];

  return (
    <div className="flex w-full flex-col gap-1">
      {/* Cards */}
      <div className="grid grid-cols-1 justify-center gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {adVideos.map((item, index) => (
          <div
            key={index}
            className={`cursor-pointer rounded-xl bg-gradient-to-r p-[1px] transition ${
              selected === index
                ? 'from-[#02C8C4] to-[#5867EB] p-[3px]'
                : 'from-white/10 to-white/10 hover:from-[#02C8C4]/30 hover:to-[#5867EB]/30'
            } `}
            onClick={() => setSelected(index)}
          >
            <div className="relative overflow-hidden rounded-xl bg-[#292929] transition">
              <div className="relative h-full w-full">
                <img src={item.image} alt={item.title} className="w-full object-cover" />
                <button className="absolute top-1/2 left-1/2 flex min-h-16 min-w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-white/20 backdrop-blur-sm">
                  <FaPlay className="size-5 text-white" />
                </button>
              </div>

              <div className="p-5">
                <p className="mb-1 text-[18px] font-bold text-white">{item.title}</p>

                <p className="text-xs text-[#BEBEBE]">
                  {item.description} <span className="text-white">Read More</span>
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
