import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { PiShareFat } from 'react-icons/pi';
import {
  X,
  ThumbsUp,
  ThumbsDown,
  PencilLine,
  Download,
  Share2,
  Redo2,
  Save,
  Eraser,
  Undo2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import AdCreativeEditorActions from './AdCreativeEditorActions';
import { useDispatch, useSelector } from 'react-redux';
import useImage from 'use-image';
import { uploadToS3 } from '@/utils/imageUpload';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const HOST = import.meta.env.VITE_SOCKET_URL;
import { Stage, Layer, Image as KonvaImage, Transformer } from 'react-konva';
import { updateFields } from '@/store/actions/adStudio/adCreativeActions';
import {
  setFeedBack,
  updateAdCreativeEditorFields,
} from '@/store/reducers/adStudio/adCreativeSlice';
import { setEditorFields } from '@/store/reducers/adStudio/editorSlice';
import { Popover, PopoverContent, PopoverTrigger } from '@radix-ui/react-popover';
import DeleteChatHistoryDialog from '@/components/common/AdPrompt/History/DeleteChatHistoryDialog';
import Warning from './Warning';
import { RiThumbDownFill, RiThumbUpFill } from 'react-icons/ri';

const defaultLogoProps = {
  x: 50,
  y: 70,
  width: undefined, // will be filled in on first transform
  height: undefined, // likewise
  rotation: 0,
};

const AdCreativeEditorLightBox = ({ closeLightbox }) => {
  const dispatch = useDispatch();
  const { baseImage, logoImage, baseWithLogoImage, botId, adIndex, isEditorOpen } = useSelector(
    (state) => state.editor
  );

  const { userData } = useSelector((state) => state.socket);

  const { conversations } = useSelector((state) => state.adCreative);
  const conversation = conversations?.find((c) => c?.id === botId) || {};

  const stageRef = useRef(null);
  const logoRef = useRef(null);
  const trRef = useRef(null);

  const [isEditMode, setIsEditMode] = useState(false);
  const [logoProps, setLogoProps] = useState(defaultLogoProps);
  const [initialLogoProps, setInitialLogoProps] = useState(defaultLogoProps);

  const [isSaving, setIsSaving] = useState(false);
  const [isLogoSelected, setIsLogoSelected] = useState(true);

  const [showWarning, setShowWarning] = useState(false);

  const [selectedLogoUrl, setSelectedLogoUrl] = useState(logoImage);

  const [stageDimensions, setStageDimensions] = useState({
    width: 0,
    height: 0,
  });

  // popover
  const [open, setOpen] = useState(false);

  const closeEditor = () => {
    resetEditorState();
    closeLightbox();
  };

  const handleAttemptClose = () => {
    if (hasLogoMovedOrResized()) {
      setShowWarning(true);
      setOpen(true);
    } else {
      closeEditor();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSaving && !open) {
        handleAttemptClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAttemptClose, isSaving, open]);

  const [baseImg, baseImgStatus] = useImage(
    `${HOST}/adsgpt/img/preview?url=${S3_BASE_URL}${baseImage}`,
    'Anonymous'
  );
  const [logoImg, logoImgStatus] = useImage(
    `${HOST}/adsgpt/img/preview?url=${selectedLogoUrl}`,
    'Anonymous'
  );
  const [baseWithLogoImg, baseWithLogoImgStatus] = useImage(
    `${HOST}/adsgpt/img/preview?url=${S3_BASE_URL}${baseWithLogoImage}`,
    'Anonymous'
  );

  const showArrows =
    !isEditMode && (conversation?.ads?.length || 0) > 1 && baseImgStatus === 'loaded';

  useEffect(() => {
    if (isEditorOpen) {
      // setIsEditMode(false);
      // setLogoProps(defaultLogoProps);
      dispatch(
        setEditorFields({
          editorImage: baseImage,
          editorLogo: selectedLogoUrl,
        })
      );
    } else {
      dispatch(
        setEditorFields({
          editorImage: baseWithLogoImage,
          editorLogo: selectedLogoUrl,
        })
      );
    }
  }, [isEditorOpen, dispatch, baseWithLogoImage, selectedLogoUrl, baseImage]);

  // set when logo updates
  // useEffect(() => {
  //   if (logoImage && selectedLogoUrl !== logoImage) {
  //     setSelectedLogoUrl(logoImage);
  //   }
  // }, [logoImage, selectedLogoUrl]);

  // draw resize border without lagging when logo changes
  useEffect(() => {
    if (isEditMode && isLogoSelected && trRef.current && logoRef.current) {
      trRef.current.nodes([logoRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isEditMode, isLogoSelected, logoProps]);

  const hasLogoMovedOrResized = () => {
    return (
      (logoProps.x !== initialLogoProps.x ||
        logoProps.y !== initialLogoProps.y ||
        logoProps.width !== initialLogoProps.width ||
        logoProps.height !== initialLogoProps.height ||
        logoProps.rotation !== initialLogoProps.rotation) &&
      isEditMode
    );
  };

  const updateConversationsState = async (image_url) => {
    // Update local fields
    dispatch(
      updateAdCreativeEditorFields({
        botId,
        index: adIndex,
        field: 'image_ad',
        value: image_url,
      })
    );

    dispatch(
      updateAdCreativeEditorFields({
        botId,
        index: adIndex,
        field: 'logo',
        value: selectedLogoUrl,
      })
    );

    // Update history
    dispatch(
      updateFields({
        botId,
        index: adIndex,
        field: 'image_ad',
        value: image_url,
      })
    );
    dispatch(
      updateFields({
        botId,
        index: adIndex,
        field: 'logo',
        value: selectedLogoUrl,
      })
    );

    // Update editor state
    dispatch(
      setEditorFields({
        logoImage: selectedLogoUrl,
        baseWithLogoImage: image_url,
      })
    );
  };

  const getDataURL = () => {
    // remove transformer
    detachTransformer();

    const exportCanvas = document.createElement('canvas');
    const exportWidth = baseImg?.naturalWidth;
    const exportHeight = baseImg?.naturalHeight;
    exportCanvas.width = exportWidth;
    exportCanvas.height = exportHeight;

    const exportStage = new window.Konva.Stage({
      width: exportWidth,
      height: exportHeight,
      container: document.createElement('div'),
    });

    const exportLayer = new window.Konva.Layer();
    exportStage.add(exportLayer);

    if (hasLogoMovedOrResized() && logoImg) {
      exportLayer.add(
        new window.Konva.Image({
          image: baseImg,
          width: exportWidth,
          height: exportHeight,
        })
      );

      const scaleX = exportWidth / stageDimensions.width;
      const scaleY = exportHeight / stageDimensions.height;

      const scaledLogoProps = {
        x: logoProps.x * scaleX,
        y: logoProps.y * scaleY,
        width: logoProps.width ? logoProps.width * scaleX : logoImg.naturalWidth,
        height: logoProps.height ? logoProps.height * scaleY : logoImg.naturalHeight,
        rotation: logoProps.rotation || 0,
      };

      exportLayer.add(
        new window.Konva.Image({
          image: logoImg,
          ...scaledLogoProps,
          offsetX: 0,
          offsetY: 0,
        })
      );
    } else {
      exportLayer.add(
        new window.Konva.Image({
          image: baseWithLogoImg,
          width: baseWithLogoImg.naturalWidth,
          height: baseWithLogoImg.naturalHeight,
        })
      );
    }

    exportLayer.draw();
    const dataURL = exportStage.toDataURL({ pixelRatio: 1 });
    return dataURL;
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);

      const dataURL = getDataURL() || '';
      if (!dataURL) return;
      const res = await fetch(dataURL);
      const blob = await res.blob();
      const file = new File([blob], 'final-image.png', { type: 'image/png' });
      const uploadedUrl = await uploadToS3(file, userData?.user_id);

      await updateConversationsState(uploadedUrl);

      setInitialLogoProps(logoProps);

      setIsEditMode(false);
      setIsLogoSelected(false);
      // setLogoProps(defaultLogoProps);
      trRef.current?.nodes([]);
      stageRef.current?.batchDraw();
    } catch (err) {
      console.error('❌ Error saving composition:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClickOutside = (e) => {
    const name = e.target?.name?.();
    const isTransformerHandle =
      e.target?.getParent()?.className === 'Transformer' || name?.includes('anchor');

    const shouldDeselect = name !== 'logo-image' && name !== 'transformer' && !isTransformerHandle;

    if (shouldDeselect) {
      setIsLogoSelected(false);
    }
  };

  // Set initial stage dimensions based on base image size
  useEffect(() => {
    const handleResize = () => {
      if (baseImg && isEditorOpen) {
        const availableWidth = window.innerWidth * 0.6; // Adjust percentage to hit 600-700px
        const availableHeight = window.innerHeight * 0.6;
        const scale = Math.min(
          availableWidth / baseImg.naturalWidth,
          availableHeight / baseImg.naturalHeight
        );
        setStageDimensions({
          width: baseImg.naturalWidth * scale,
          height: baseImg.naturalHeight * scale,
        });
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [baseImg, isEditorOpen]);

  // Fit logo to base image on first load
  useEffect(() => {
    if (logoImg && baseImg && isEditorOpen && (!logoProps.width || !logoProps.height)) {
      // if (!logoProps.width || !logoProps.height) {
      const maxWidth = baseImg.naturalWidth * 0.2;
      const maxHeight = baseImg.naturalHeight * 0.2;

      const aspectRatio = logoImg.naturalWidth / logoImg.naturalHeight;

      const width = Math.min(maxWidth, logoImg.naturalWidth);
      const height = width / aspectRatio;

      const fittedProps = {
        ...defaultLogoProps,
        width,
        height,
      };

      setLogoProps(fittedProps);
      setInitialLogoProps(fittedProps);
      //  } // store as "original"
    }
  }, [logoImg, baseImg, isEditorOpen]);

  // draw transformet on image load
  useEffect(() => {
    if (isEditMode && isLogoSelected && trRef.current && logoRef.current && logoImg?.complete) {
      trRef.current.nodes([logoRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isEditMode, isLogoSelected, logoImg]);

  useEffect(() => {
    if (logoImg?.complete) {
      trRef.current?.nodes([logoRef.current]);
      trRef.current?.getLayer()?.batchDraw();
    }
  }, [logoImg]);

  const detachTransformer = () => {
    if (trRef.current) {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
    }
  };

  const attachTransformer = () => {
    if (trRef.current && logoRef.current) {
      trRef.current.nodes([logoRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  };

  const handleDownload = () => {
    if (!stageRef.current) return;

    // 🔹 Step 1: Generate data URL
    const uri = getDataURL() || '';
    if (!uri) return;

    // 🔹 Step 2: Download the image
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.download = `creative_${timestamp}.png`;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 🔹 Step 3: Reattach Transformer
    attachTransformer();
  };

  useEffect(() => {
    if (
      logoImg &&
      logoImg.complete &&
      isEditorOpen &&
      baseImg &&
      logoImg.naturalWidth > 0 &&
      logoImg.naturalHeight > 0
    ) {
      const MAX_LOGO_WIDTH = baseImg.naturalWidth * 0.2;
      const MAX_LOGO_HEIGHT = baseImg.naturalHeight * 0.2;

      let width = logoImg.naturalWidth;
      let height = logoImg.naturalHeight;

      // Only scale down (never scale up)
      if (width > MAX_LOGO_WIDTH || height > MAX_LOGO_HEIGHT) {
        const widthRatio = MAX_LOGO_WIDTH / width;
        const heightRatio = MAX_LOGO_HEIGHT / height;
        const scale = Math.min(widthRatio, heightRatio);
        width = width * scale;
        height = height * scale;
      }

      const newLogoProps = {
        x: logoProps.x, // Preserve previous position
        y: logoProps.y,
        width,
        height,
        rotation: logoProps.rotation || 0,
      };

      setLogoProps(newLogoProps);
      // setInitialLogoProps(newLogoProps);
    }
  }, [logoImg?.src, isEditorOpen, baseImg]);

  //  Reset all
  const resetEditorState = () => {
    setIsEditMode(false);
    setIsSaving(false);
    setIsLogoSelected(false);
    setShowWarning(false);
    setLogoProps(defaultLogoProps);
    setInitialLogoProps(defaultLogoProps);
    setSelectedLogoUrl(logoImage);
    trRef.current?.nodes([]);
    stageRef.current?.batchDraw();
  };

  const handleBoundDragMove = (e, stageWidth, stageHeight) => {
    const node = e.target;
    const box = node.getClientRect(); // bounding box

    let x = node.x();
    let y = node.y();

    // Left boundary
    if (box.x < 0) {
      x = node.x() - box.x;
    }

    // Right boundary
    if (box.x + box.width > stageWidth) {
      x = node.x() - (box.x + box.width - stageWidth);
    }

    // Top boundary
    if (box.y < 0) {
      y = node.y() - box.y;
    }

    // Bottom boundary
    if (box.y + box.height > stageHeight) {
      y = node.y() - (box.y + box.height - stageHeight);
    }

    node.position({ x, y });
  };

  const handleLikeDislike = (botId, currentFeedback, index, type) => {
    dispatch(
      setFeedBack({
        botId,
        index,
        feedback: currentFeedback === type ? null : type,
      })
    );
    dispatch(
      updateFields({
        botId,
        index,
        field: 'feedback',
        value: currentFeedback === type ? null : type,
      })
    );
  };

  const handleNavigation = (direction) => {
    const ads = conversation?.ads || [];
    const newIndex = direction === 'next' ? adIndex + 1 : adIndex - 1;

    if (newIndex >= 0 && newIndex < ads.length) {
      const ad = ads[newIndex];
      dispatch(
        setEditorFields({
          adIndex: newIndex,
          baseImage: ad.image_ad,
          baseWithLogoImage: ad.image_ad,
          logoImage: ad.logo,
        })
      );
      resetEditorState();
      setSelectedLogoUrl(ad.logo);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: '#0D0D0D50',
        backdropFilter: 'blur(100px)',
      }}
    >
      {(isSaving ||
        baseWithLogoImgStatus === 'loading' ||
        (isEditMode &&
          ((logoImgStatus === 'loading' && selectedLogoUrl) || baseImgStatus === 'loading'))) && (
        <div className="bg-opacity-60 absolute inset-0 z-50 flex items-center justify-center rounded-xl bg-black">
          <div className="border-opacity-80 h-12 w-12 animate-spin rounded-full border-t-4 border-white"></div>
        </div>
      )}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative -top-10 flex items-center justify-center"
      >
        {/* Image */}
        {/* <img
          src={lightboxImage}
          alt="Lightbox view"
          className="h-[60vh] rounded-2xl object-contain shadow-2xl"
        /> */}
        <Stage
          width={stageDimensions.width}
          height={stageDimensions.height}
          ref={stageRef}
          // pixelRatio={4}
          onMouseDown={handleClickOutside}
          onTouchStart={handleClickOutside}
          onContextMenu={(e) => e.evt.preventDefault()}
        >
          <Layer>
            <KonvaImage
              name="base-image"
              image={isEditMode ? baseImg : baseWithLogoImg}
              width={stageDimensions.width}
              height={stageDimensions.height}
            />
            {isEditMode && (
              <>
                <KonvaImage
                  name="logo-image"
                  width={logoImg?.naturalWidth}
                  height={logoImg?.naturalHeight}
                  image={logoImg}
                  {...logoProps}
                  rotation={logoProps.rotation}
                  draggable={isEditMode}
                  perfectDrawEnabled={false}
                  onClick={() => setIsLogoSelected(true)}
                  onTap={() => setIsLogoSelected(true)}
                  onDragMove={(e) => {
                    handleBoundDragMove(e, stageDimensions.width, stageDimensions.height);
                    setIsLogoSelected(true);
                  }}
                  onDragEnd={(e) => {
                    const node = e.target;
                    setLogoProps({
                      x: node.x(),
                      y: node.y(),
                      width: node.width() * node.scaleX(),
                      height: node.height() * node.scaleY(),
                      rotation: node.rotation(),
                    });
                  }}
                  onTransformEnd={() => {
                    const node = logoRef.current;
                    // capture scale and rotation
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();
                    const rotation = node.rotation();

                    // compute actual size
                    const newW = Math.round(node.width() * scaleX);
                    const newH = Math.round(node.height() * scaleY);
                    const newX = node.x();
                    const newY = node.y();

                    // reset transform state
                    node.scaleX(1);
                    node.scaleY(1);

                    setLogoProps({
                      x: newX,
                      y: newY,
                      width: newW,
                      height: newH,
                      rotation,
                    });
                  }}
                  ref={logoRef}
                />
                {isLogoSelected && logoImgStatus === 'loaded' && (
                  <Transformer
                    ref={trRef}
                    boundBoxFunc={(oldBox, newBox) => newBox}
                    enabledAnchors={[
                      'top-left',
                      'top-right',
                      'bottom-left',
                      'bottom-right',
                      'top-center',
                      'bottom-center',
                      'middle-left',
                      'middle-right',
                    ]}
                    rotateEnabled={true}
                    anchorStroke="#1d4ed8"
                    anchorFill="#fff"
                    anchorSize={12}
                    anchorCornerRadius={6}
                    anchorStrokeWidth={2}
                    borderStroke="#1d4ed8"
                    borderStrokeWidth={2}
                    borderDash={[6, 4]}
                    anchorDragDistance={1}
                  />
                )}
              </>
            )}
          </Layer>
        </Stage>

        {/* Navigation Arrows */}
        {showArrows && (
          <>
            <button
              className={`absolute top-1/2 -left-5 z-50 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 disabled:opacity-40 2xl:-left-6 2xl:p-2 ${adIndex === 0 ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              onClick={(e) => {
                e.stopPropagation();
                handleNavigation('prev');
              }}
              disabled={adIndex === 0}
            >
              <ChevronLeft className="h-6 w-6 2xl:h-8 2xl:w-8" />
            </button>
            <button
              className={`absolute top-1/2 -right-5 z-50 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 disabled:opacity-40 2xl:-right-6 2xl:p-2 ${adIndex === (conversation?.ads?.length || 0) - 1 ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              onClick={(e) => {
                e.stopPropagation();
                handleNavigation('next');
              }}
              disabled={adIndex === (conversation?.ads?.length || 0) - 1}
            >
              <ChevronRight className="h-6 w-6 2xl:h-8 2xl:w-8" />
            </button>
          </>
        )}
      </motion.div>

      {/* the buttons of actions */}
      <div className="fixed top-3 flex w-[98vw] flex-wrap items-center justify-between gap-4 2xl:top-10 2xl:w-[90vw]">
        {/* Left Actions */}
        <div className="left_actions">
          <button
            onClick={handleAttemptClose}
            disabled={isSaving}
            className={`rounded-sm border border-transparent p-1.5 text-[#AFAFAF] transition-all hover:border-white/20 hover:bg-[#202020]/50 2xl:p-2 dark:hover:text-white ${isSaving ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            title="Close"
          >
            <X className="h-5 w-5 2xl:h-6 2xl:w-6" />
          </button>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild></PopoverTrigger>
            <PopoverContent className="max-w-fit border-white/20 p-2 backdrop-blur-[100px] dark:bg-[#0D0D0D]/50">
              <Warning
                open={showWarning}
                onDelete={closeEditor}
                onSave={() => {
                  handleSave();
                  setShowWarning(false);
                }}
                onClose={() => {
                  setShowWarning(false);
                  setOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        {!isEditMode ? (
          // {/* Right Actions */}
          <div className="right_actions mb-3 flex flex-wrap items-center justify-center gap-1.5">
            <button
              onClick={() => {
                setIsLogoSelected(true);
                setIsEditMode(true);
              }}
              className="animated-border rounded-sm border p-2.5 text-white transition-all dark:hover:text-white"
              title="Edit"
              style={{
                '--ab-width': 'fit-content',
                '--ab-height': 'auto',
                '--ab-radius': '10px',
                '--ab-border-size': '1.5px',
                '--ab-bg': '#1a1a1a',
                '--color-1': '#afafaf',
                '--color-3': '#fff',
                '--color-4': 'transparent',
                '--color-2': 'transparent',
              }}
            >
              <PencilLine className="h-5 w-5" />
            </button>

            {/* <button
              className="rounded-sm border border-transparent p-2.5 text-[#AFAFAF] transition-all hover:border-white/20 hover:bg-[#202020]/50 dark:hover:text-white"
              title="Like"
              onClick={() =>
                handleLikeDislike(botId, conversation?.ads?.[adIndex]?.feedback, adIndex, 'like')
              }
            >
              {conversation?.ads?.[adIndex]?.feedback === 'like' ? (
                <RiThumbUpFill className="h-5 w-5" />
              ) : (
                <ThumbsUp className="h-5 w-5" />
              )}
            </button> */}

            {/* <button
              className="rounded-sm border border-transparent p-2.5 text-[#AFAFAF] transition-all hover:border-white/20 hover:bg-[#202020]/50 dark:hover:text-white"
              title="Dislike"
              onClick={() =>
                handleLikeDislike(botId, conversation?.ads?.[adIndex]?.feedback, adIndex, 'dislike')
              }
            >
              {conversation?.ads?.[adIndex]?.feedback === 'dislike' ? (
                <RiThumbDownFill className="h-5 w-5" />
              ) : (
                <ThumbsDown className="h-5 w-5" />
              )}
            </button> */}

            <button
              className={`rounded-sm border border-transparent p-2.5 text-[#AFAFAF] transition-all hover:border-white/20 hover:bg-[#202020]/50 dark:hover:text-white ${isSaving ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              title="Download"
              onClick={handleDownload}
            >
              <Download className="h-5 w-5" />
            </button>

            {/* <button
              className="rounded-sm border border-transparent p-2.5 text-[#AFAFAF] transition-all hover:border-white/20 hover:bg-[#202020]/50 dark:hover:text-white"
              title="Share"
            >
              <PiShareFat className="h-5 w-5" />
            </button> */}
          </div>
        ) : (
          // {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <AdCreativeEditorActions
              onSelectLogo={(newLogoUrl) => {
                setIsLogoSelected(true);
                setIsEditMode(true);
                setSelectedLogoUrl(newLogoUrl);
              }}
            />

            {/* <button className="rounded-md border border-transparent p-2.5 text-[#AFAFAF] transition-all hover:border-white/20 hover:bg-[#202020]/50 hover:text-white">
              <Undo2 className="h-5 w-5" />
            </button> */}

            {/* <button className="rounded-md border border-transparent p-2.5 text-[#AFAFAF] transition-all hover:border-white/20 hover:bg-[#202020]/50 hover:text-white">
              <Redo2 className="h-5 w-5" />
            </button> */}

            {/* <button className="rounded-md border border-transparent p-2.5 text-[#AFAFAF] transition-all hover:border-white/20 hover:bg-[#202020]/50 hover:text-white">
              <Eraser className="h-5 w-5" />
            </button> */}
            <button
              className={`rounded-md border border-transparent px-2.5 py-2 text-[#AFAFAF] transition-all hover:border-white/20 hover:bg-[#202020]/50 hover:text-white ${
                !hasLogoMovedOrResized() || isSaving ? 'cursor-not-allowed' : 'cursor-pointer'
              }`}
              disabled={!hasLogoMovedOrResized() || isSaving}
              onClick={handleSave}
            >
              Save
            </button>

            <button
              onClick={resetEditorState}
              disabled={isSaving}
              className={`rounded-md border border-transparent px-2.5 py-2 text-[#AFAFAF] transition-all hover:border-white/20 hover:bg-[#202020]/50 hover:text-white ${isSaving ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default AdCreativeEditorLightBox;
