import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { nanoid } from 'nanoid';
import { UploadCloud, Link2, Sparkles, Loader2, ImageOff, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import CreativeFilterDropdown from '@/components/layout/header/AdStudio/AdCreative/CreativeFilterDropdown';
import { getAdFactoryImages } from '@/apis/adFactory/adFactoryImagesApi';
import { getAllImages } from '@/apis/image/imageApi';
import { uploadToS3, uploadUrlToS3 } from '@/utils/imageUpload';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

// Relative S3 keys need the bucket prefix; blob/data/http URLs pass through.
const resolveUrl = (u) => {
  if (!u) return '';
  return u.startsWith('http') || u.startsWith('blob:') || u.startsWith('data:')
    ? u
    : `${S3_BASE_URL}${u}`;
};

const TABS = [
  { key: 'upload', label: 'Upload', icon: UploadCloud },
  { key: 'link', label: 'From link', icon: Link2 },
  { key: 'app', label: 'From your app', icon: Sparkles },
];

const AddImageDialog = ({ open, onClose, onAdd, userId }) => {
  const [tab, setTab] = useState('upload');

  // Reset to the first tab every time the dialog is opened afresh.
  useEffect(() => {
    if (open) setTab('upload');
  }, [open]);

  // src = display URL, key = value we persist (S3 key or full URL).
  const commit = ({ src, key, source }) => {
    if (!src) return;
    onAdd?.({ id: `user-${nanoid(6)}`, src, key: key || src, isUser: true, source });
    onClose?.();
  };

  const shared = { userId, onCommit: commit };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add an image</DialogTitle>
          <DialogDescription>
            Upload from your device, paste a link, or reuse one you already made.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 rounded-full bg-black/5 p-1 dark:bg-white/5">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-all ${
                tab === key
                  ? 'bg-gray-900 text-white shadow dark:bg-white dark:text-black'
                  : 'text-gray-500 hover:text-gray-900 dark:text-white/60 dark:hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div>
          {tab === 'upload' && <UploadPanel {...shared} />}
          {tab === 'link' && <LinkPanel {...shared} />}
          {tab === 'app' && <AppLibraryPanel {...shared} />}
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Upload from device                                                 */
/* ------------------------------------------------------------------ */
const UploadPanel = ({ userId, onCommit }) => {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null); // { url, name, file }
  const [uploading, setUploading] = useState(false);

  // Revoke the object URL when the preview changes / unmounts.
  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const handleFile = useCallback(
    (file) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.error('Please choose an image file.');
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        toast.error('Image is too large (max 15 MB).');
        return;
      }
      if (!userId) {
        toast.error('Please sign in again to upload.');
        return;
      }

      const localUrl = URL.createObjectURL(file);
      setPreview({ url: localUrl, name: file.name, file });
      return;
      /* setUploading(true);
      try {
        // Re-host on S3 via the shared upload util (isUser=true → don't add it
        // to the user's saved gallery, it's just for this ad).
        const key = await uploadToS3(file, userId, true);
        if (!key) throw new Error('No URL returned');
        onCommit({ src: resolveUrl(key), key, source: 'upload' });
      } catch (e) {
        toast.error('Upload failed. Please try again.');
        setUploading(false);
      } */
    },
    [userId]
  );

  const handleConfirm = async () => {
    if (!preview?.file || uploading) return;
    setUploading(true);
    try {
      const key = await uploadToS3(preview.file, userId, true);
      if (!key) throw new Error('No URL returned');
      onCommit({ src: resolveUrl(key), key, source: 'upload' });
    } catch {
      toast.error('Upload failed. Please try again.');
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex h-64 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-all ${
          dragging
            ? 'border-[#2364B8] bg-[#2364B8]/5'
            : 'border-black/15 hover:border-black/30 dark:border-white/15 dark:hover:border-white/30'
        }`}
      >
        {preview ? (
          <div className="relative h-full w-full overflow-hidden rounded-xl">
            <img src={preview.url} alt={preview.name} className="h-full w-full object-contain" />
            {uploading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs font-medium">Uploading…</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2364B8]/10 text-[#2364B8]">
              <UploadCloud className="h-6 w-6" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                Drag &amp; drop an image here
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-white/50">
                or <span className="text-[#2364B8]">browse</span> — PNG, JPG, WEBP up to 15 MB
              </p>
            </div>
          </>
        )}
      </button>
      <button
        type="button"
        disabled={!preview || uploading}
        onClick={handleConfirm}
        className={`flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
          preview && !uploading
            ? 'bg-gray-900 text-white hover:opacity-80 dark:bg-white dark:text-black'
            : 'cursor-not-allowed bg-black/10 text-gray-400 dark:bg-white/10 dark:text-white/40'
        }`}
      >
        {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Adding...</> : <><Check className="h-4 w-4" /> Add this image</>}
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* From a link                                                        */
/* ------------------------------------------------------------------ */
const LinkPanel = ({ userId, onCommit }) => {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | ok | error
  const [adding, setAdding] = useState(false);
  const [pastedImage, setPastedImage] = useState(null); // { file, url }

  useEffect(() => {
    return () => {
      if (pastedImage?.url) URL.revokeObjectURL(pastedImage.url);
    };
  }, [pastedImage]);

  const handlePaste = (event) => {
    const imageItem = Array.from(event.clipboardData?.items || []).find(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    );
    if (!imageItem) return;

    event.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error('Image is too large (max 15 MB).');
      return;
    }
    if (!userId) {
      toast.error('Please sign in again to add images.');
      return;
    }

    setValue('');
    setPastedImage({ file, url: URL.createObjectURL(file) });
  };

  const handleValueChange = (event) => {
    setPastedImage(null);
    setValue(event.target.value);
  };

  const handleAdd = async () => {
    if (pastedImage?.file) {
      setAdding(true);
      try {
        const key = await uploadToS3(pastedImage.file, userId, true);
        if (!key) throw new Error('No URL returned');
        onCommit({ src: resolveUrl(key), key, source: 'upload' });
      } catch {
        toast.error('Could not add the pasted image. Please try again.');
        setAdding(false);
      }
      return;
    }

    const url = value.trim();
    if (!url) return;
    if (!userId) {
      toast.error('Please sign in again to add images.');
      return;
    }
    setAdding(true);
    try {
      // Re-host the external link on our S3 (server-side fetch) so the ad never
      // depends on it.
      const key = await uploadUrlToS3(url, userId);
      if (!key) throw new Error('No URL returned');
      onCommit({ src: resolveUrl(key), key, source: 'link' });
    } catch (e) {
      toast.error('Could not save that image. Please try another link.');
      setAdding(false);
    }
  };

  // Debounced validation: actually try to load the image.
  useEffect(() => {
    const url = value.trim();
    if (!url) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    const img = new Image();
    let cancelled = false;
    const t = setTimeout(() => {
      img.onload = () => !cancelled && setStatus('ok');
      img.onerror = () => !cancelled && setStatus('error');
      img.src = url;
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
      img.onload = img.onerror = null;
    };
  }, [value]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="relative">
          <Link2 className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-white/40" />
          <input
            type="url"
            autoFocus
            value={value}
            onChange={handleValueChange}
            onPaste={handlePaste}
            placeholder="Paste an image or https://example.com/image.jpg"
            className="w-full rounded-2xl border border-black/15 bg-transparent py-3 pr-4 pl-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2364B8] focus:outline-none dark:border-white/15 dark:text-white dark:placeholder:text-white/40"
          />
        </div>
        {status === 'error' && (
          <p className="mt-1.5 px-1 text-xs text-red-500">
            We couldn&apos;t load an image from that link.
          </p>
        )}
      </div>

      {/* Live preview */}
      <div className="flex h-52 items-center justify-center overflow-hidden rounded-2xl bg-black/5 dark:bg-white/5">
        {pastedImage ? (
          <img src={pastedImage.url} alt="Pasted image preview" className="h-full w-full object-contain" />
        ) : status === 'ok' ? (
          <img src={value.trim()} alt="Preview" className="h-full w-full object-contain" />
        ) : status === 'loading' ? (
          <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-white/40" />
        ) : status === 'error' ? (
          <div className="flex flex-col items-center gap-2 text-gray-400 dark:text-white/40">
            <ImageOff className="h-7 w-7" />
            <span className="text-xs">No preview</span>
          </div>
        ) : (
          <span className="text-xs text-gray-400 dark:text-white/40">Paste a link or image to add it</span>
        )}
      </div>

      <button
        disabled={(!pastedImage && status !== 'ok') || adding}
        onClick={handleAdd}
        className={`flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
          (pastedImage || status === 'ok') && !adding
            ? 'bg-gray-900 text-white hover:opacity-80 dark:bg-white dark:text-black'
            : 'cursor-not-allowed bg-black/10 text-gray-400 dark:bg-white/10 dark:text-white/40'
        }`}
      >
        {adding ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Saving…
          </>
        ) : (
          <>
            <Check className="h-4 w-4" /> Add this image
          </>
        )}
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* From the user's app-wide generated images                          */
/* ------------------------------------------------------------------ */
// Same source values/labels as MySpace's image-source dropdown.
const LIBRARY_SOURCES = [
  { value: 'adFactory', label: 'AdFactory' },
  { value: 'adCreative', label: 'AdCreative' },
];
const PAGE_SIZE = 18;

const mapAdFactory = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .filter((i) => i?.status === 'success' && i?.url)
    .map((i) => ({ key: i.url, src: resolveUrl(i.url), prompt: i.prompt }));

const mapAdCreative = (rows) => {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((rec) => {
    if (rec?.status !== 'completed') return; // skip pending / processing / failed
    const prompt = rec?.inputs?.userPrompt || rec?.inputs?.prompt;
    const results = Array.isArray(rec?.results) ? rec.results : [];
    results.forEach((r) => {
      const u = r?.url || r?.generatedImageUrl || r?.s3Url || r?.imageUrl || r?.s3_url;
      if (u) out.push({ key: u, src: resolveUrl(u), prompt });
    });
  });
  return out;
};

const AppLibraryPanel = ({ userId, onCommit }) => {
  const [source, setSource] = useState('adFactory');
  const [items, setItems] = useState([]);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true); // first page
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(null); // { id, src, key } — confirm before commit
  const scrollRef = useRef(null);

  const fetchPage = useCallback(
    async (nextSkip) => {
      if (source === 'adFactory') {
        const res = await getAdFactoryImages({ userId, skip: nextSkip, limit: PAGE_SIZE });
        const page = Array.isArray(res?.data) ? res.data : [];
        return { mapped: mapAdFactory(page), rawCount: page.length };
      }
      const res = await getAllImages({ skip: nextSkip, limit: PAGE_SIZE });
      const payload = res?.data ?? res;
      const rows = Array.isArray(payload) ? payload : payload?.items || [];
      return { mapped: mapAdCreative(rows), rawCount: rows.length };
    },
    [source, userId]
  );

  // (Re)load the first page whenever the source changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) {
        setLoading(false);
        setError(true);
        return;
      }
      setLoading(true);
      setError(false);
      setItems([]);
      setSkip(0);
      setHasMore(true);
      setSelected(null);
      try {
        const { mapped, rawCount } = await fetchPage(0);
        if (cancelled) return;
        setItems(mapped);
        setSkip(rawCount);
        setHasMore(rawCount === PAGE_SIZE);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage, userId]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const { mapped, rawCount } = await fetchPage(skip);
      setItems((prev) => [...prev, ...mapped]);
      setSkip((s) => s + rawCount);
      setHasMore(rawCount === PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop <= el.clientHeight + 120) loadMore();
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Source dropdown — same sources MySpace offers. SelectContent is bumped
          to z-[70] so it renders above the dialog overlay (z-55). */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-white/50">Browse images from</span>
        <CreativeFilterDropdown
          options={LIBRARY_SOURCES}
          label="Source"
          value={LIBRARY_SOURCES.find((item) => item.value === source)}
          onChange={setSource}
          contentClassName="z-70"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid max-h-104 grid-cols-4 gap-2 overflow-y-auto">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
          ))}
        </div>
      ) : error || items.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-2xl bg-black/5 text-center dark:bg-white/5">
          <ImageOff className="h-7 w-7 text-gray-400 dark:text-white/40" />
          <p className="text-sm text-gray-500 dark:text-white/50">
            {error ? 'Could not load your images.' : 'No images found here yet.'}
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="grid max-h-104 grid-cols-4 gap-2 overflow-y-auto pr-1"
        >
          {items.map((item, idx) => {
            const id = `${item.key}-${idx}`;
            const isSelected = selected?.id === id;
            return (
              <button
                key={id}
                onClick={() => setSelected({ id, src: item.src, key: item.key })}
                title={item.prompt || 'Select this image'}
                className={`group relative aspect-square overflow-hidden rounded-xl bg-black/5 transition-all hover:ring-2 hover:ring-[#2364B8] dark:bg-white/5 ${
                  isSelected ? 'ring-2 ring-[#2364B8]' : ''
                }`}
              >
                <img
                  src={item.src}
                  alt={item.prompt || 'Generated image'}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {/* Selected check badge */}
                {isSelected && (
                  <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#2364B8] text-white">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
                <div
                  className={`absolute inset-0 flex items-center justify-center transition-all ${
                    isSelected
                      ? 'bg-black/30'
                      : 'bg-black/0 opacity-0 group-hover:bg-black/40 group-hover:opacity-100'
                  }`}
                >
                  {!isSelected && (
                    // Visibility is gated on this tile's own hover (opacity-0 →
                    // group-hover:opacity-100), not the parent overlay's fade.
                    // Otherwise, when a previously-selected tile deselects, the
                    // overlay's opacity transition would flash "Select" for a
                    // frame even though the cursor is on a different tile.
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black opacity-0 transition-opacity group-hover:opacity-100">
                      Select
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {/* Infinite-scroll footer */}
          {loadingMore && (
            <div className="col-span-4 flex justify-center py-3">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400 dark:text-white/40" />
            </div>
          )}
        </div>
      )}

      {/* Confirm — mirrors the Upload/Link tabs' explicit add step */}
      <button
        disabled={!selected}
        onClick={() => selected && onCommit({ src: selected.src, key: selected.key, source: 'app' })}
        className={`flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition-all ${
          selected
            ? 'bg-gray-900 text-white hover:opacity-80 dark:bg-white dark:text-black'
            : 'cursor-not-allowed bg-black/10 text-gray-400 dark:bg-white/10 dark:text-white/40'
        }`}
      >
        <Check className="h-4 w-4" /> Add this image
      </button>
    </div>
  );
};

export default AddImageDialog;
