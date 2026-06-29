// Local, dev-only mock specs for the ChoiceForm cascade UI.
//
// Triggered from ChatInterface when the user types:
//   /cascade video   → video brief picker
//   /cascade ad      → ad creative brief picker
//   /cascade copy    → ad copy brief picker
//
// These mirror the SSE `choice_form` event payload the Python agent will
// emit once the protocol is live, so the production code path stays the
// same — only the source of the form spec changes. Delete this file (and
// its imports in ChatInterface) once the agent emits real forms.

import { nanoid } from '@reduxjs/toolkit';

const VIDEO_FORM = () => ({
  form_id: `mock_vid_${nanoid(8)}`,
  title: "Let's set up your video",
  subtitle: "Pick what you want — I'll fill in the rest.",
  estimated_credits: 90,
  submit_label: 'Generate video',
  fields: [
    {
      key: 'idea',
      type: 'textarea',
      label: 'What is the video about?',
      placeholder: '30-second product demo for Nike Pegasus 41 — focus on the new foam',
      required: true,
      rows: 3,
    },
    {
      key: 'style',
      type: 'segmented',
      label: 'Style',
      options: ['UGC', 'Cinematic', 'Product demo', 'B-roll'],
      default: 'Cinematic',
    },
    {
      key: 'aspect_ratio',
      type: 'segmented',
      label: 'Aspect ratio',
      options: ['16:9', '9:16', '1:1'],
      default: '9:16',
    },
    {
      key: 'duration_seconds',
      type: 'segmented',
      label: 'Duration',
      options: [
        { value: 6, label: '6s' },
        { value: 10, label: '10s' },
        { value: 15, label: '15s' },
      ],
      default: 6,
    },
    {
      key: 'count',
      type: 'segmented',
      label: 'How many variants?',
      options: [
        { value: 1, label: '1 video' },
        { value: 3, label: '3 videos' },
      ],
      default: 3,
    },
    {
      key: 'model',
      type: 'select',
      label: 'Model',
      options: [
        { value: 'veo-3.1-fast', label: 'Veo 3.1 Fast (default)' },
        { value: 'veo-3.1', label: 'Veo 3.1' },
        { value: 'veo-3.1-4k', label: 'Veo 3.1 4K' },
        { value: 'seedance-2-fast', label: 'Seedance 2.0 Fast' },
        { value: 'sora-2-pro', label: 'OpenAI Sora 2 Pro' },
      ],
      default: 'veo-3.1-fast',
    },
  ],
});

const AD_FORM = () => ({
  form_id: `mock_ad_${nanoid(8)}`,
  title: "Let's set up your ad",
  subtitle: 'Three angle-aligned variants will be generated.',
  estimated_credits: 30,
  submit_label: 'Generate ads',
  fields: [
    {
      key: 'product',
      type: 'text',
      label: 'Product or subject',
      placeholder: 'Nike Pegasus 41 running shoes',
      required: true,
    },
    {
      key: 'platform',
      type: 'segmented',
      label: 'Platform',
      options: ['Meta', 'TikTok', 'LinkedIn', 'YouTube', 'Google'],
      default: 'Meta',
    },
    {
      key: 'angle',
      type: 'segmented',
      label: 'Angle direction',
      description: 'Default = 3 distinct angles',
      options: [
        { value: '', label: 'Default (3 angles)' },
        { value: 'emotional', label: 'Emotional' },
        { value: 'direct_value', label: 'Direct value' },
        { value: 'playful', label: 'Playful' },
        { value: 'urgency', label: 'Urgency' },
        { value: 'authority', label: 'Authority' },
      ],
      default: '',
    },
    {
      key: 'aspect_ratio',
      type: 'segmented',
      label: 'Aspect ratio',
      options: ['1:1', '4:5', '9:16', '16:9'],
      default: '1:1',
    },
    {
      key: 'extra_context',
      type: 'textarea',
      label: 'Extra creative direction',
      placeholder: 'Optional — e.g. "Black Friday flash sale", "soft launch energy"',
      rows: 2,
    },
    {
      key: 'provider',
      type: 'select',
      label: 'Model',
      options: [
        { value: 'gemini', label: 'Gemini (default)' },
        { value: 'openai', label: 'OpenAI' },
      ],
      default: 'gemini',
    },
  ],
});

const COPY_FORM = () => ({
  form_id: `mock_copy_${nanoid(8)}`,
  title: "Let's write your ad copy",
  subtitle: 'Headline + body + CTA + hashtags for any platform.',
  estimated_credits: 1,
  submit_label: 'Write copy',
  fields: [
    {
      key: 'product',
      type: 'text',
      label: 'Product',
      placeholder: 'Notion AI for engineering teams',
      required: true,
    },
    {
      key: 'audience',
      type: 'text',
      label: 'Audience',
      placeholder: 'Engineering managers at Series B startups, 28–45',
      required: true,
    },
    {
      key: 'platform',
      type: 'segmented',
      label: 'Platform',
      options: ['Facebook', 'Instagram', 'Google', 'LinkedIn', 'Twitter', 'TikTok', 'YouTube'],
      default: 'LinkedIn',
    },
    {
      key: 'tone',
      type: 'segmented',
      label: 'Tone',
      options: ['Friendly', 'Professional', 'Playful', 'Urgent', 'Premium', 'Edgy'],
      default: 'Professional',
    },
    {
      key: 'extra_context',
      type: 'textarea',
      label: 'Extra context (optional)',
      placeholder: 'USPs, brand voice rules, promo details…',
      rows: 2,
    },
  ],
});

const BUILDERS = {
  video: VIDEO_FORM,
  ad: AD_FORM,
  copy: COPY_FORM,
};

// Parse `/cascade <kind>` from the start of a user message. Returns the
// kind ("video" | "ad" | "copy") or null if the message isn't a cascade
// command. `kind` defaults to "video" so a bare `/cascade` still works.
export const parseCascadeCommand = (text) => {
  const trimmed = (text || '').trim();
  if (!trimmed.toLowerCase().startsWith('/cascade')) return null;
  const rest = trimmed.slice('/cascade'.length).trim().toLowerCase();
  const kind = rest.split(/\s+/)[0] || 'video';
  return BUILDERS[kind] ? kind : 'video';
};

export const buildMockChoiceForm = (kind) => {
  const builder = BUILDERS[kind] || VIDEO_FORM;
  return builder();
};

// Format a one-line summary of submitted values for the mock follow-up
// assistant message. Keeps the demo legible without doing real generation.
export const mockChoiceFormResult = (kind, values) => {
  const v = values || {};
  if (kind === 'video') {
    return (
      `Locked in — generating ${v.count || 1} ${v.style || 'Cinematic'} ` +
      `${v.aspect_ratio || '9:16'} video${(v.count || 1) > 1 ? 's' : ''} ` +
      `at ${v.duration_seconds || 6}s each, model ${v.model || 'veo-3.1-fast'}. ` +
      `Idea: "${(v.idea || '').slice(0, 120)}". ` +
      `(Demo — no real generation. Once the agent is wired this will run for real.)`
    );
  }
  if (kind === 'ad') {
    const angleLabel = v.angle ? `${v.angle} angle` : 'three distinct angles';
    return (
      `On it — three ${angleLabel === 'three distinct angles' ? angleLabel : `variants on the ${angleLabel}`} ` +
      `for ${v.product || 'your product'} on ${v.platform || 'Meta'}, ` +
      `${v.aspect_ratio || '1:1'}, via ${v.provider || 'gemini'}. ` +
      `(Demo — no real generation yet.)`
    );
  }
  if (kind === 'copy') {
    return (
      `Writing ${v.tone || 'professional'} ad copy for ${v.product || 'your product'} ` +
      `on ${v.platform || 'LinkedIn'}, audience: "${v.audience || 'unspecified'}". ` +
      `(Demo — no real generation yet.)`
    );
  }
  return 'Submitted. (Demo — no real generation yet.)';
};
