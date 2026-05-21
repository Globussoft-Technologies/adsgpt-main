import { useWindowSize } from '@react-hook/window-size';
import { useEffect, useMemo, useRef, useState } from 'react';
import Masonry from 'react-masonry-css';
import AdCreativesCard from '../AdCreativeCard';
import AdCreativeCardLoader from '@/components/AdStudio/Loader/Cards/AdCreativeCardLoader';

const MasonryLayout = ({ toggleOpenAdCreativeChat }) => {
  const [width] = useWindowSize();
  const [loading, setLoading] = useState(true);

  const containerRef = useRef(null);

  // Breakpoints
  const columnCount = useMemo(() => {
    if (width < 500) return 1;
    if (width < 750) return 2;
    if (width < 900) return 2;
    if (width < 1200) return 3;
    if (width < 1700) return 4;
    return 5;
  }, [width]);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  const creativesImages = [
    { imageUrl: 'https://i.ibb.co/fG9GSPMB/image-1.png' },
    { imageUrl: 'https://i.ibb.co/qF3v8BTW/image-2.png' },
    { imageUrl: 'https://i.ibb.co/3GP1QFt/image-3.png' },
    { imageUrl: 'https://i.ibb.co/cWJYNBT/image-4.png' },
    { imageUrl: 'https://i.ibb.co/HDYWGcCX/image-6.png' },
  ];

  const getRandomIndex = (length) => Math.floor(Math.random() * length);
  const data = Array.from({ length: 400 }).map((_, i) => {
    const randomImg1 = creativesImages[getRandomIndex(creativesImages.length)].imageUrl;
    const randomImg2 = creativesImages[getRandomIndex(creativesImages.length)].imageUrl;

    return {
      id: i + 1,
      userName: `User ${i + 1}`,
      userAvatar: `https://picsum.photos/50/50?random=${i + 1}`,
      images: [randomImg1, randomImg2],
      title: `Creative ${i + 1}`,
      description: `This is a static sample description for Creative ${i + 1}.`,
    };
  });

  return (
    <div
      ref={containerRef}
      className="box-border h-full w-full overflow-x-hidden overflow-y-auto px-10 pb-40"
    >
      <div className="box-border p-4">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 2xl:gap-5">
            {Array.from({ length: 20 }).map((_, index) => (
              <AdCreativeCardLoader key={index} />
            ))}
          </div>
        ) : (
          <Masonry
            breakpointCols={columnCount}
            className="my-masonry-grid outline-none"
            columnClassName="my-masonry-grid_column"
          >
            {data.map((item, i) => (
              <AdCreativesCard
                key={i}
                userName={item.userName}
                userAvatar={item.userAvatar}
                images={item.images}
                title={item.title}
                description={item.description}
                toggleOpenAdCreativeChat={toggleOpenAdCreativeChat}
              />
            ))}
          </Masonry>
        )}
      </div>
    </div>
  );
};

export default MasonryLayout;
