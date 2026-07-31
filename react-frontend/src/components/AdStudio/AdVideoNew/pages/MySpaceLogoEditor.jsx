import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, PencilLine, Download } from 'lucide-react';
import { useSelector } from 'react-redux';
import useImage from 'use-image';
import Konva from 'konva';
import { Stage, Layer, Image as KonvaImage, Transformer } from 'react-konva';
import { uploadToS3 } from '@/utils/imageUpload';
import AdCreativeEditorActions from '@/components/AdStudio/AdCreatives/CreativeChat/Lightbox/AdCreativeEditorActions';
import Warning from '@/components/AdStudio/AdCreatives/CreativeChat/Lightbox/Warning';
import { Popover, PopoverContent, PopoverTrigger } from '@radix-ui/react-popover';

const HOST = import.meta.env.VITE_SOCKET_URL;

// Route every image through the CORS proxy so Konva's canvas export isn't
// tainted (toDataURL throws on cross-origin images loaded without CORS).
// Un-encoded `url=` param matches the proven old-editor contract.
// Exported so callers (e.g. ImageCard) can preload the same URL to warm
// the HTTP cache before mounting this editor.
export const proxied = (url) => (url ? `${HOST}/adsgpt/img/preview?url=${url}` : '');

const defaultLogoProps = { x: 0, y: 0, width: undefined, height: undefined, rotation: 0 };

/**
 * MySpace logo editor — places a single brand logo onto an existing
 * generated image and flattens the two into a new PNG.
 *
 * Two images in (base + logo), one out. Unlike the old AdCreative editor
 * this carries no view mode, no conversation/botId machinery, and never
 * touches the original record: `onSaved(newUrl)` hands the flattened URL
 * back so the parent can surface it as a brand-new MySpace card.
 *
 * Props:
 *   baseImageUrl — absolute URL of the image to edit (the canvas)
 *   userId       — for the S3 upload
 *   onClose()    — dismiss the editor
 *   onSaved(url) — called with the uploaded composite URL after Save
 */
export default function MySpaceLogoEditor({ baseImageUrl, userId, onClose, onSaved }) {
  const { userData } = useSelector((state) => state.socket);
  const resolvedUserId = userId ?? userData?.user_id;

  const stageRef = useRef(null);
  const logoRef = useRef(null);
  const trRef = useRef(null);

  const [selectedLogoUrl, setSelectedLogoUrl] = useState(null);
  const [logoProps, setLogoProps] = useState(defaultLogoProps);
  const [isLogoSelected, setIsLogoSelected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [open, setOpen] = useState(false);
  const [stageDimensions, setStageDimensions] = useState({ width: 0, height: 0 });

  const [baseImg, baseImgStatus] = useImage(proxied(baseImageUrl), 'Anonymous');
  const [logoImg, logoImgStatus] = useImage(proxied(selectedLogoUrl), 'Anonymous');

  // ── stage sizing: fit the base image into ~60vw × 70vh ──────────────
  useEffect(() => {
    const fit = () => {
      if (!baseImg) return;
      const availableWidth = window.innerWidth * 0.6;
      const availableHeight = window.innerHeight * 0.7;
      const scale = Math.min(
        availableWidth / baseImg.naturalWidth,
        availableHeight / baseImg.naturalHeight
      );
      setStageDimensions({
        width: baseImg.naturalWidth * scale,
        height: baseImg.naturalHeight * scale,
      });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [baseImg]);

  // ── fit logo to ~25% of the on-screen stage on first load / swap ────
  useEffect(() => {
    if (!logoImg || !stageDimensions.width) return;
    const maxWidth = stageDimensions.width * 0.25;
    const aspect = logoImg.naturalWidth / logoImg.naturalHeight;
    const width = Math.min(maxWidth, logoImg.naturalWidth);
    const height = width / aspect;
    const fitted = {
      x: stageDimensions.width * 0.05,
      y: stageDimensions.height * 0.05,
      width,
      height,
      rotation: 0,
    };
    setLogoProps(fitted);
    setIsLogoSelected(true);
  }, [logoImg, stageDimensions.width, stageDimensions.height]);

  // ── keep the transformer attached to the logo node ──────────────────
  useEffect(() => {
    if (isLogoSelected && trRef.current && logoRef.current && logoImgStatus === 'loaded') {
      trRef.current.nodes([logoRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isLogoSelected, logoImgStatus, logoProps]);

  const detachTransformer = () => {
    trRef.current?.nodes([]);
    trRef.current?.getLayer()?.batchDraw();
  };

  const attachTransformer = () => {
    if (trRef.current && logoRef.current) {
      trRef.current.nodes([logoRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  };

  // Composite base + logo at the base image's natural resolution.
  const getDataURL = () => {
    if (!baseImg) return '';
    detachTransformer();

    const exportWidth = baseImg.naturalWidth;
    const exportHeight = baseImg.naturalHeight;

    const exportStage = new Konva.Stage({
      width: exportWidth,
      height: exportHeight,
      container: document.createElement('div'),
    });
    const exportLayer = new Konva.Layer();
    exportStage.add(exportLayer);

    exportLayer.add(new Konva.Image({ image: baseImg, width: exportWidth, height: exportHeight }));

    if (selectedLogoUrl && logoImg) {
      const scaleX = exportWidth / stageDimensions.width;
      const scaleY = exportHeight / stageDimensions.height;
      exportLayer.add(
        new Konva.Image({
          image: logoImg,
          x: logoProps.x * scaleX,
          y: logoProps.y * scaleY,
          width: (logoProps.width ?? logoImg.naturalWidth) * scaleX,
          height: (logoProps.height ?? logoImg.naturalHeight) * scaleY,
          rotation: logoProps.rotation || 0,
        })
      );
    }

    exportLayer.draw();
    const dataURL = exportStage.toDataURL({ pixelRatio: 1 });
    attachTransformer();
    return dataURL;
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const dataURL = getDataURL();
      if (!dataURL) return;
      const res = await fetch(dataURL);
      const blob = await res.blob();
      const file = new File([blob], 'logo-edited.png', { type: 'image/png' });
      const uploadedUrl = await uploadToS3(file, resolvedUserId);
      if (uploadedUrl) {
        onSaved?.(uploadedUrl);
        onClose?.();
      }
    } catch (err) {
      console.error('❌ Error saving logo composition:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = () => {
    const uri = getDataURL();
    if (!uri) return;
    const link = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.download = `logo_edit_${ts}.png`;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAttemptClose = () => {
    if (selectedLogoUrl && !isSaving) {
      setShowWarning(true);
      setOpen(true);
    } else {
      onClose?.();
    }
  };

  // Esc closes (unless saving or the warning popover is open)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !isSaving && !open) handleAttemptClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const handleBoundDragMove = (e) => {
    const node = e.target;
    const box = node.getClientRect();
    let x = node.x();
    let y = node.y();
    if (box.x < 0) x = node.x() - box.x;
    if (box.x + box.width > stageDimensions.width)
      x = node.x() - (box.x + box.width - stageDimensions.width);
    if (box.y < 0) y = node.y() - box.y;
    if (box.y + box.height > stageDimensions.height)
      y = node.y() - (box.y + box.height - stageDimensions.height);
    node.position({ x, y });
  };

  const handleClickOutside = (e) => {
    const name = e.target?.name?.();
    const isHandle =
      e.target?.getParent()?.className === 'Transformer' || name?.includes('anchor');
    if (name !== 'logo-image' && !isHandle) setIsLogoSelected(false);
  };

  const loading =
    isSaving ||
    baseImgStatus === 'loading' ||
    (selectedLogoUrl && logoImgStatus === 'loading');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-60 flex items-center justify-center"
      style={{ backgroundColor: '#0D0D0D50', backdropFilter: 'blur(100px)' }}
    >
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="h-12 w-12 animate-spin rounded-full border-t-4 border-white/80" />
        </div>
      )}

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative -top-6 flex items-center justify-center"
      >
        <Stage
          width={stageDimensions.width}
          height={stageDimensions.height}
          ref={stageRef}
          onMouseDown={handleClickOutside}
          onTouchStart={handleClickOutside}
          onContextMenu={(e) => e.evt.preventDefault()}
        >
          <Layer>
            <KonvaImage
              name="base-image"
              image={baseImg}
              width={stageDimensions.width}
              height={stageDimensions.height}
            />
            {selectedLogoUrl && logoImg && (
              <>
                <KonvaImage
                  name="logo-image"
                  image={logoImg}
                  {...logoProps}
                  draggable
                  perfectDrawEnabled={false}
                  onClick={() => setIsLogoSelected(true)}
                  onTap={() => setIsLogoSelected(true)}
                  onDragMove={(e) => {
                    handleBoundDragMove(e);
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
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();
                    const rotation = node.rotation();
                    const newW = Math.round(node.width() * scaleX);
                    const newH = Math.round(node.height() * scaleY);
                    const newX = node.x();
                    const newY = node.y();
                    node.scaleX(1);
                    node.scaleY(1);
                    setLogoProps({ x: newX, y: newY, width: newW, height: newH, rotation });
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
                    rotateEnabled
                    anchorStroke="#1d4ed8"
                    anchorFill="#fff"
                    anchorSize={12}
                    anchorCornerRadius={6}
                    anchorStrokeWidth={2}
                    borderStroke="#1d4ed8"
                    borderStrokeWidth={2}
                    borderDash={[6, 4]}
                  />
                )}
              </>
            )}
          </Layer>
        </Stage>
      </motion.div>

      {/* Action bar */}
      <div className="fixed top-3 flex w-[98vw] flex-wrap items-center justify-between gap-4 2xl:top-10 2xl:w-[90vw]">
        <div className="left_actions">
          <button
            onClick={handleAttemptClose}
            disabled={isSaving}
            className={`rounded-sm border border-transparent p-1.5 transition-all bg-black/20 dark:bg-transparent text-gray-100 dark:text-[#AFAFAF] hover:border-white/20 hover:bg-[#202020]/50 hover:text-white 2xl:p-2 ${isSaving ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            title="Close"
          >
            <X className="h-5 w-5 2xl:h-6 2xl:w-6" />
          </button>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild></PopoverTrigger>
            <PopoverContent className="max-w-fit border-white/20 p-2 backdrop-blur-100 dark:bg-[#0D0D0D]/50">
              <Warning
                open={showWarning}
                onDelete={() => onClose?.()}
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

        <div className="right_actions mb-3 flex flex-wrap items-center justify-center gap-1.5">
          <AdCreativeEditorActions
            onSelectLogo={(newLogoUrl) => {
              setSelectedLogoUrl(newLogoUrl);
              setIsLogoSelected(true);
            }}
          />

          <button
            className={`rounded-sm border border-transparent p-2.5 text-gray-100 transition-all bg-black/20  dark:bg-transparent hover:text-white dark:text-[#AFAFAF] hover:border-white/20 hover:bg-[#202020]/50 dark:hover:text-white ${isSaving || !selectedLogoUrl ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            title="Download"
            onClick={handleDownload}
            disabled={!selectedLogoUrl || isSaving}
          >
            <Download className="h-5 w-5" />
          </button>

          <button
            className={`rounded-md border border-transparent px-3 py-2 text-sm transition-all ${
              !selectedLogoUrl || isSaving
                ? 'cursor-not-allowed text-gray-200 dark:text-[#6f6f6f]'
                : 'cursor-pointer text-white hover:border-white/20 hover:bg-[#202020]/50'
            }`}
            disabled={!selectedLogoUrl || isSaving}
            onClick={handleSave}
          >
            Save as new
          </button>
        </div>
      </div>
    </motion.div>
  );
}
