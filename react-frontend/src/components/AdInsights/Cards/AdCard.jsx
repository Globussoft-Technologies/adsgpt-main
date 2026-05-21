import { Separator } from '@/components/ui/separator';
import { TrendingUp } from 'lucide-react';
import React from 'react';

const AdCard = ({ type, url, description, popularity }) => {
  const getYouTubeEmbedUrl = (url) => {
    let videoId = '';
    if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1].split('?')[0];
    } else if (url.includes('youtube.com/watch')) {
      const params = new URLSearchParams(url.split('?')[1]);
      videoId = params.get('v');
    } else if (url.includes('youtube.com/shorts/')) {
      videoId = url.split('youtube.com/shorts/')[1].split('?')[0];
    }

    return `https://www.youtube.com/embed/${videoId}`;
  };

  return (
    <div className="rounded-10 w-full overflow-hidden border border-white/10 bg-[#0D0D0D] text-white">
      {/* Top Media */}
      <div className="w-full">
        {type === 'image' ? (
          <img src={url} alt="Ad" className="h-full w-full object-cover" />
        ) : type === 'text' ? (
          <>
            <p className="p-4 text-sm break-words text-[#AFAFAF] 2xl:text-base">{url}</p>
          </>
        ) : (
          <iframe
            src={getYouTubeEmbedUrl(url)}
            title="YouTube video player"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="aspect-video w-full object-cover"
          ></iframe>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-3.5 p-3 2xl:p-4">
        <p className="text-xs text-[#AFAFAF] 2xl:text-sm">{description}</p>
        <Separator />

        <div className="button_ flex items-center justify-center">
          <button className="prompt_selection_button text-10 relative z-10 w-fit rounded-full bg-[#1E1E1E] px-4 py-1.5 text-center !text-[#AFAFAF] hover:bg-[#2A2A2A] hover:!text-white 2xl:py-2 2xl:text-xs">
            Show Analytics
          </button>
        </div>
      </div>

      {/* Popularity */}
      <div className="flex items-center justify-center gap-2 bg-[#333333]/50 py-3 text-xs text-[#AFAFAF] 2xl:text-sm">
        <TrendingUp className="h-4 w-4" />
        <span>Popularity : {popularity}%</span>
      </div>
    </div>
  );
};

export default AdCard;
