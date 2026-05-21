// AdCreativeCardLayout.jsx
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Masonry, useResizeObserver } from 'masonic';
import { useWindowSize } from '@react-hook/window-size';
import AdCreativesCard from '../AdCreativeCard';
import AdCreativeCardLoader from '@/components/AdStudio/Loader/Cards/AdCreativeCardLoader';
import { useSidebar } from '@/components/ui/sidebar';

const AdCreativeCardLayout = () => {
  const [width] = useWindowSize();
  const [loading, setLoading] = useState(true);
  const containerRef = useRef(null);
  const { open: isSidebarOpen } = useSidebar();

  // ✅ State to force masonry re-render when container resizes
  const [containerKey, setContainerKey] = useState(0);
  const lastWidthRef = useRef(null);

  // ✅ Observe container resize (fixes sidebar expand/collapse issue)
  const resizeObserver = useResizeObserver(containerRef);

  // ✅ Add ResizeObserver to detect container width changes (debounced)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const newWidth = entry.contentRect.width;

        // Only trigger if width actually changed significantly
        if (lastWidthRef.current === null || Math.abs(newWidth - lastWidthRef.current) > 10) {
          lastWidthRef.current = newWidth;

          // Debounce the update
          setTimeout(() => {
            setContainerKey((prev) => prev + 1);
          }, 100);
        }
      }
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  // ✅ Also trigger re-layout when sidebar state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setContainerKey((prev) => prev + 1);
    }, 300); // Wait for sidebar animation to complete

    return () => clearTimeout(timer);
  }, [isSidebarOpen]);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  // Breakpoints
  const columnCount = useMemo(() => {
    if (width < 500) return 1;
    if (width < 750) return 2;
    if (width < 900) return 2;
    if (width < 1200) return 3;
    if (width < 1700) return 4;
    return 5;
  }, [width]);

  const creativesImages = [
    { imageUrl: 'https://i.ibb.co/fG9GSPMB/image-1.png' },
    { imageUrl: 'https://i.ibb.co/qF3v8BTW/image-2.png' },
    { imageUrl: 'https://i.ibb.co/3GP1QFt/image-3.png' },
    { imageUrl: 'https://i.ibb.co/cWJYNBT/image-4.png' },
    { imageUrl: 'https://i.ibb.co/HDYWGcCX/image-6.png' },
  ];

  const getRandomIndex = (length) => Math.floor(Math.random() * length);
  const data = Array.from({ length: 1000 }).map((_, i) => {
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
    <div ref={containerRef} className="box-border h-full w-full overflow-x-hidden overflow-y-auto">
      <div className="box-border p-4">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 2xl:gap-5">
            {Array.from({ length: 20 }).map((_, index) => (
              <AdCreativeCardLoader key={index} />
            ))}
          </div>
        ) : (
          <Masonry
            key={containerKey} // ✅ Forces re-render when container resizes
            items={data}
            columnCount={columnCount}
            columnGutter={16}
            render={({ data }) => (
              <AdCreativesCard
                userName={data.userName}
                userAvatar={data.userAvatar}
                images={data.images}
                title={data.title}
                description={data.description}
              />
            )}
          />

          //  <div className="grid grid-cols-1 gap-4 2xl:gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          //   {data.map((data) => (
          //     <AdCreativesCard
          //       key={data.id}
          //       userName={data.userName}
          //       userAvatar={data.userAvatar}
          //       images={data.images}
          //       title={data.title}
          //       description={data.description}
          //     />
          //   ))}
          // </div>
        )}
      </div>
    </div>
  );
};

export default AdCreativeCardLayout;
