import { useWindowSize } from '@react-hook/window-size';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  Masonry as RVMasonry,
} from 'react-virtualized';
import { createCellPositioner } from 'react-virtualized/dist/es/Masonry';
import AdCreativesCard from '../AdCreativeCard';
import AdCreativeCardLoader from '@/components/AdStudio/Loader/Cards/AdCreativeCardLoader';

const MasonryVirtualizedLayout = ({ toggleOpenAdCreativeChat }) => {
  const [width, height] = useWindowSize();
  const [loading, setLoading] = useState(true);

  const containerRef = useRef(null);
  const masonryRef = useRef(null);

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

  // react-virtualized Masonry setup
  const gutterSize = 20;

  const cacheRef = useRef(
    new CellMeasurerCache({ defaultHeight: 320, defaultWidth: 200, fixedWidth: true })
  );

  const cellPositionerRef = useRef(null);
  const [columnWidthState, setColumnWidthState] = useState(200);
  const [containerWidthState, setContainerWidthState] = useState(0);

  const initOrResetCellPositioner = useCallback(
    (containerWidth) => {
      if (!containerWidth) return;
      const columnWidth = Math.max(
        180,
        Math.floor((containerWidth - (columnCount - 1) * gutterSize) / columnCount)
      );

      // Initialize on first run
      if (!cellPositionerRef.current) {
        cellPositionerRef.current = createCellPositioner({
          cellMeasurerCache: cacheRef.current,
          columnCount,
          columnWidth,
          spacer: gutterSize,
        });
      } else {
        // Reset on subsequent changes
        cacheRef.current.clearAll();
        cellPositionerRef.current.reset({
          columnCount,
          columnWidth,
          spacer: gutterSize,
        });
        if (masonryRef.current) {
          masonryRef.current.recomputeCellPositions();
        }
      }

      cacheRef.current._defaultWidth = columnWidth; // keep cache consistent with column width
      setColumnWidthState(columnWidth);
    },
    [columnCount]
  );

  useEffect(() => {
    if (containerWidthState > 0) {
      initOrResetCellPositioner(containerWidthState);
    }
  }, [containerWidthState, columnCount, initOrResetCellPositioner]);

  const cellRenderer = ({ index, key, parent, style }) => {
    const item = data[index];
    return (
      <CellMeasurer cache={cacheRef.current} index={index} key={key} parent={parent}>
        <div style={{ ...style, width: columnWidthState }} className="outline-none">
          <AdCreativesCard
            userName={item.userName}
            userAvatar={item.userAvatar}
            images={item.images}
            title={item.title}
            description={item.description}
            toggleOpenAdCreativeChat={toggleOpenAdCreativeChat}
          />
        </div>
      </CellMeasurer>
    );
  };

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
          <div className="my-masonry-grid outline-none">
            <AutoSizer
              disableHeight
              onResize={({ width: nextWidth }) => setContainerWidthState(nextWidth)}
            >
              {({ width: autoWidth }) => {
                if (autoWidth !== containerWidthState) {
                  // Keep state in sync without double work; init happens in effect
                  setContainerWidthState(autoWidth);
                }
                return cellPositionerRef.current ? (
                  <RVMasonry
                    ref={masonryRef}
                    cellCount={data.length}
                    cellMeasurerCache={cacheRef.current}
                    cellPositioner={cellPositionerRef.current}
                    cellRenderer={cellRenderer}
                    height={Math.max(400, height - 120)}
                    width={autoWidth}
                    overscanByPixels={200}
                  />
                ) : (
                  <div style={{ width: autoWidth, height: Math.max(400, height - 120) }} />
                );
              }}
            </AutoSizer>
          </div>
        )}
      </div>
    </div>
  );
};

export default MasonryVirtualizedLayout;
