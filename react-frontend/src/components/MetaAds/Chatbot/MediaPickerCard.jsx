import React, { useRef, useState } from 'react';
import { ImagePlus, Library, Loader2, Upload, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { globalToast } from '@/utils/globalToast';
import LibraryPicker from '../LibraryPicker';
import { uploadChatMedia } from '@/apis/metaAds/metaChatApi';

// Client-side validation gate (fail fast; the backend validates too). Mirrors
// the wizard's wizardFields.validateMediaFile, kept local so this feature is
// self-contained and doesn't depend on that module's internals.
const ALLOWED = {
  image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  video: new Set(['video/mp4', 'video/quicktime', 'video/webm']),
};
const MAX_BYTES = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 };

const validateFile = (file, kind) => {
  if (!file) return false;
  if (!ALLOWED[kind].has(file.type)) {
    globalToast.error(
      kind === 'video'
        ? 'Unsupported video format. Use MP4, MOV, or WEBM.'
        : 'Unsupported image format. Use JPG, PNG, WEBP, or GIF.',
    );
    return false;
  }
  if (file.size > MAX_BYTES[kind]) {
    const maxMb = Math.round(MAX_BYTES[kind] / (1024 * 1024));
    globalToast.error(`File is too large. Max ${maxMb} MB for ${kind}s.`);
    return false;
  }
  return true;
};

const TabButton = ({ active, onClick, disabled, icon: Icon, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
      active
        ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-white'
        : 'text-gray-500 hover:text-gray-800 dark:text-white/55 dark:hover:text-white'
    }`}
  >
    <Icon className="h-3.5 w-3.5" />
    {children}
  </button>
);

// Rendered when the assistant pauses on pick_creative_media — the user chooses
// creative media (library / upload) and confirms, or cancels. On confirm the
// media's public URL is sent back to resume the turn (see MetaAdsChatPanel's
// handleMediaPick → pickChatMedia).
const MediaPickerCard = ({ mediaType = 'image', purpose, busy, onSubmit, onCancel }) => {
  const [tab, setTab] = useState('library'); // 'library' | 'upload'
  const [selectedUrl, setSelectedUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const fileInputRef = useRef(null);

  const isVideo = mediaType === 'video';
  const disabled = busy || uploading;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    // reset the input so re-selecting the same file still fires onChange
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || !validateFile(file, mediaType)) return;
    setUploading(true);
    try {
      const { url } = await uploadChatMedia(file);
      if (url) setSelectedUrl(url);
      else globalToast.error('Upload failed — no URL returned.');
    } catch (err) {
      globalToast.error(err?.response?.data?.error || err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleAttachUrl = () => {
    const u = urlDraft.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      globalToast.error('Enter a valid http(s) URL.');
      return;
    }
    setSelectedUrl(u);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#15DCFF]/40 bg-[#15DCFF]/[0.06] p-4 shadow-sm dark:border-[#15DCFF]/25 dark:bg-[#15DCFF]/[0.04]">
      <div className="flex items-start gap-2">
        <ImagePlus className="mt-0.5 size-4 shrink-0 text-[#0891b2] dark:text-[#15DCFF]" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Choose {isVideo ? 'a video' : 'an image'} for your ad
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {purpose || `Pick from your library or upload ${isVideo ? 'a video' : 'an image'}.`}
          </p>
        </div>
      </div>

      {/* tabs */}
      <div className="flex w-fit gap-1 rounded-xl bg-black/5 p-1 dark:bg-white/5">
        <TabButton
          active={tab === 'library'}
          onClick={() => setTab('library')}
          disabled={disabled}
          icon={Library}
        >
          From library
        </TabButton>
        <TabButton
          active={tab === 'upload'}
          onClick={() => setTab('upload')}
          disabled={disabled}
          icon={Upload}
        >
          Upload
        </TabButton>
      </div>

      {tab === 'library' ? (
        <div className={disabled ? 'pointer-events-none opacity-60' : ''}>
          <LibraryPicker
            type={mediaType}
            selectedUrl={selectedUrl}
            onPick={(url) => setSelectedUrl(url)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-sm text-gray-600 transition-colors hover:border-[#15DCFF]/60 hover:bg-[#15DCFF]/5 disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.03] dark:text-white/60"
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[#15DCFF]" />
            ) : (
              <Upload className="h-5 w-5 text-gray-400 dark:text-white/40" />
            )}
            <span>{uploading ? 'Uploading…' : `Click to upload ${isVideo ? 'a video' : 'an image'}`}</span>
            <span className="text-[11px] text-gray-400 dark:text-white/40">
              {isVideo ? 'MP4, MOV, WEBM · up to 100 MB' : 'JPG, PNG, WEBP, GIF · up to 10 MB'}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={isVideo ? 'video/mp4,video/quicktime,video/webm' : 'image/jpeg,image/png,image/webp,image/gif'}
            className="hidden"
            onChange={handleFile}
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAttachUrl();
                }
              }}
              disabled={disabled}
              placeholder="…or paste a media URL"
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 outline-none focus:border-[#15DCFF]/60 disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-white"
            />
            <Button variant="outline" size="sm" disabled={disabled || !urlDraft.trim()} onClick={handleAttachUrl}>
              Attach
            </Button>
          </div>
        </div>
      )}

      {/* selected preview */}
      {selectedUrl && (
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white/60 p-2 dark:border-white/10 dark:bg-white/5">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-black/5 dark:bg-white/10">
            {isVideo ? (
              <video src={selectedUrl} className="h-full w-full object-cover" muted playsInline />
            ) : (
              <img src={selectedUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-gray-600 dark:text-white/60">
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <span className="truncate">Selected — ready to use</span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          <X className="mr-1 size-3.5" /> Cancel
        </Button>
        <Button
          size="sm"
          className="border-0 bg-gradient-to-br from-[#15DCFF] to-[#6b72f8] text-white hover:opacity-90"
          disabled={disabled || !selectedUrl}
          onClick={() => selectedUrl && onSubmit(selectedUrl, mediaType)}
        >
          {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Check className="mr-1 size-3.5" />}
          Use this media
        </Button>
      </div>
    </div>
  );
};

export default MediaPickerCard;
