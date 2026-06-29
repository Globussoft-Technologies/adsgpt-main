import { useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Film,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';

import {
  generateVideoScene,
  mergeVideoClips,
} from '@/apis/aiAssistant/aiAssistantApi';
import toMediaUrl from '@/utils/mediaUrl';
import {
  setStoryboardFinalVideo,
  updateStoryboardScene,
} from '@/store/reducers/aiAssistant/aiAssistantSlice';

// Mirrors backend MCPs/routers/video_pipeline.py SUPPORTED_MODELS.
const MODEL_OPTIONS = [
  { value: 'seedance-2', label: 'Seedance 2.0' },
  { value: 'seedance-2-fast', label: 'Seedance 2.0 Fast' },
  { value: 'veo-3.1', label: 'Veo 3.1' },
  { value: 'veo-3.1-fast', label: 'Veo 3.1 Fast' },
  { value: 'veo-3.1-4k', label: 'Veo 3.1 4K' },
  { value: 'sora-2-pro', label: 'Sora 2 Pro' },
  { value: 'sora-2-pro-4k', label: 'Sora 2 Pro 4K' },
];

const formatTimecode = (totalSeconds = 0) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const STATUS_BADGE = {
  draft: { label: 'Draft', cls: 'bg-white/10 text-white/65' },
  generating: { label: 'Generating', cls: 'bg-yellow-500/15 text-yellow-300' },
  done: { label: 'Ready', cls: 'bg-emerald-500/15 text-emerald-300' },
  failed: { label: 'Failed', cls: 'bg-red-500/15 text-red-300' },
};

const SceneCard = ({ scene, messageId, aspectRatio }) => {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(!scene.clip_url); // collapsed once it has a clip
  const [editing, setEditing] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(scene.visual_prompt || '');
  const [draftScript, setDraftScript] = useState(scene.script || '');
  const [draftModel, setDraftModel] = useState(
    scene.model || scene.suggested_model || 'veo-3.1-fast',
  );
  const [draftDuration, setDraftDuration] = useState(scene.duration || 6);

  const status = scene.status || 'draft';
  const badge = STATUS_BADGE[status] || STATUS_BADGE.draft;
  const isBusy = status === 'generating';

  const persistEdit = () => {
    dispatch(
      updateStoryboardScene({
        messageId,
        sceneId: scene.id,
        patch: {
          visual_prompt: draftPrompt.trim(),
          script: draftScript.trim(),
          model: draftModel,
          duration: Math.max(3, Math.min(12, parseInt(draftDuration, 10) || 6)),
        },
      }),
    );
    setEditing(false);
  };

  const runGeneration = async () => {
    if (isBusy) return;
    dispatch(
      updateStoryboardScene({
        messageId,
        sceneId: scene.id,
        patch: { status: 'generating' },
      }),
    );
    try {
      const result = await generateVideoScene({
        prompt: draftPrompt.trim() || scene.visual_prompt,
        duration: scene.duration || 6,
        model: draftModel,
        aspectRatio: aspectRatio || scene.aspect_ratio || '16:9',
        sceneId: scene.id,
      });
      dispatch(
        updateStoryboardScene({
          messageId,
          sceneId: scene.id,
          patch: {
            status: 'done',
            clip_url: result.url,
            clip_filename: result.filename,
            model: result.model || draftModel,
            duration: result.duration || scene.duration,
          },
        }),
      );
      setOpen(false);
      toast.success(`Scene ${scene.index || ''} ready`);
    } catch (err) {
      dispatch(
        updateStoryboardScene({
          messageId,
          sceneId: scene.id,
          patch: { status: 'failed' },
        }),
      );
      toast.error(
        err?.response?.data?.detail || err?.message || 'Scene generation failed',
      );
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0F0F0F] overflow-hidden">
      {/* Header — index + timecode + status + collapse toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-white/[0.02]"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white/85">
          {scene.index || '?'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] font-mono text-white/60">
              {formatTimecode(scene.timecode_start)} – {formatTimecode(scene.timecode_end)}
            </span>
            <span className="text-[11px] text-white/40">·</span>
            <span className="text-[11px] text-white/50">{scene.duration}s</span>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-white/85">
            {scene.visual_prompt || 'No prompt yet'}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
          {isBusy ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {badge.label}
            </span>
          ) : (
            badge.label
          )}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-white/40" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/40" />
        )}
      </button>

      {open && (
        <div className="border-t border-white/5 p-3.5">
          {/* Preview area: clip if done, else placeholder */}
          {scene.clip_url ? (
            <video
              key={scene.clip_url}
              src={toMediaUrl(scene.clip_url)}
              controls
              className="mb-3 w-full rounded-xl border border-white/10 bg-black"
            />
          ) : (
            <div className="mb-3 flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] text-white/30">
              <Film className="h-7 w-7" />
            </div>
          )}

          {editing ? (
            <div className="space-y-2.5">
              <label className="block text-[11px] uppercase tracking-wide text-white/40">
                Visual prompt
              </label>
              <textarea
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[13px] leading-relaxed text-white outline-none placeholder:text-white/30 focus:border-white/25"
                placeholder="Describe what we see — subject, action, camera, lighting, mood"
              />
              <label className="block text-[11px] uppercase tracking-wide text-white/40">
                Voiceover / on-screen text
              </label>
              <input
                value={draftScript}
                onChange={(e) => setDraftScript(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/30 focus:border-white/25"
                placeholder="(optional) voiceover line for this scene"
              />
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/40 px-2 py-1">
                  <span className="text-[10px] uppercase text-white/40">Model</span>
                  <select
                    value={draftModel}
                    onChange={(e) => setDraftModel(e.target.value)}
                    className="border-none bg-transparent text-[12px] text-white outline-none"
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value} className="bg-[#0F0F0F]">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/40 px-2 py-1">
                  <span className="text-[10px] uppercase text-white/40">Duration</span>
                  <input
                    type="number"
                    min={3}
                    max={12}
                    value={draftDuration}
                    onChange={(e) => setDraftDuration(e.target.value)}
                    className="w-10 border-none bg-transparent text-[12px] text-white outline-none"
                  />
                  <span className="text-[11px] text-white/40">s</span>
                </div>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => setEditing(false)}
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/60 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={persistEdit}
                    className="rounded-full bg-white px-3 py-1 text-[11px] text-black hover:bg-white/90"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {scene.script && (
                <p className="mb-2.5 rounded-lg bg-white/[0.03] px-3 py-1.5 text-[12px] text-white/75">
                  <span className="text-[10px] uppercase tracking-wide text-white/35">Script · </span>
                  {scene.script}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/55">
                  {MODEL_OPTIONS.find((m) => m.value === (scene.model || scene.suggested_model))?.label ||
                    scene.model ||
                    scene.suggested_model}
                </span>
                <button
                  onClick={() => setEditing(true)}
                  disabled={isBusy}
                  className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/65 hover:text-white disabled:opacity-40"
                >
                  Edit
                </button>
                <button
                  onClick={runGeneration}
                  disabled={isBusy}
                  className="ml-auto flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : scene.clip_url ? (
                    <RefreshCw className="h-3 w-3" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {scene.clip_url ? 'Regenerate' : 'Generate'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const VideoStoryboard = ({ storyboard, messageId }) => {
  const dispatch = useDispatch();
  const [merging, setMerging] = useState(false);

  const scenes = storyboard?.scenes || [];
  const readyCount = useMemo(
    () => scenes.filter((s) => !!s.clip_url).length,
    [scenes],
  );
  const totalDuration = storyboard?.total_duration || 0;

  if (!storyboard || scenes.length === 0) return null;

  const canMerge = scenes.length > 0 && readyCount === scenes.length && !merging;

  const runMerge = async () => {
    if (!canMerge) return;
    setMerging(true);
    try {
      const ordered = scenes
        .slice()
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map((s) => s.clip_url)
        .filter(Boolean);
      const result = await mergeVideoClips({
        clipUrls: ordered,
        outputFilename: (storyboard.title || 'storyboard')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .slice(0, 40),
      });
      dispatch(setStoryboardFinalVideo({ messageId, url: result.url }));
      toast.success('Final video assembled');
    } catch (err) {
      toast.error(
        err?.response?.data?.detail || err?.message || 'Merge failed',
      );
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="mt-4 w-full">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 pb-2">
        <div className="flex items-baseline gap-2">
          <Film className="h-3.5 w-3.5 self-center text-white/50" />
          <h3 className="text-[14px] font-medium text-white">
            {storyboard.title || 'Storyboard'}
          </h3>
          <span className="text-[11px] text-white/45">
            {scenes.length} scenes · {formatTimecode(totalDuration)} · {storyboard.aspect_ratio || '16:9'}
          </span>
        </div>
        <span className="text-[11px] text-white/40">
          {readyCount}/{scenes.length} ready
        </span>
      </div>

      {/* Scene list */}
      <div className="flex flex-col gap-2">
        {scenes.map((scene) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            messageId={messageId}
            aspectRatio={storyboard.aspect_ratio}
          />
        ))}
      </div>

      {/* Final video / merge */}
      <div className="mt-3 rounded-2xl border border-white/10 bg-[#0F0F0F] p-3.5">
        {storyboard.final_video_url ? (
          <>
            <div className="mb-2 flex items-center gap-2 text-[12px] text-emerald-300">
              <Check className="h-3.5 w-3.5" />
              Final video assembled
            </div>
            <video
              src={toMediaUrl(storyboard.final_video_url)}
              controls
              className="w-full rounded-xl border border-white/10 bg-black"
            />
            <a
              href={toMediaUrl(storyboard.final_video_url)}
              download
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-white/70 hover:text-white"
            >
              <Play className="h-3 w-3" />
              Open in new tab / download
            </a>
          </>
        ) : (
          <button
            onClick={runMerge}
            disabled={!canMerge}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-[13px] font-medium text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              readyCount < scenes.length
                ? `Generate all ${scenes.length} scenes first`
                : 'Merge clips into one MP4'
            }
          >
            {merging ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Assembling…
              </>
            ) : (
              <>
                <Film className="h-4 w-4" />
                {readyCount < scenes.length
                  ? `Generate all scenes to merge (${readyCount}/${scenes.length})`
                  : 'Merge into final video'}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default VideoStoryboard;
