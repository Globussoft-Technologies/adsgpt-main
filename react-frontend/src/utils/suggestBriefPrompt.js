import axios from 'axios';
import getCookies from '@/utils/getCookies';

// ----------------------------------------------------------------------------
// Rewrite a creative brief's prompt for a newly chosen brand / creative type.
//
// Renaming the brand inside the prompt was not enough: everything AROUND the
// name still described the previous brand, so the brief read (and generated)
// wrong. The rest of the sentence has to be rewritten, which is a model's job.
//
// Reuses the same Gemini prompt-improve endpoint behind Ad Studio's "improve
// with Gemini" wand (VITE_PROMPT_API → { suggested_prompt }); the brand context
// is folded into the text we send since the endpoint takes no brand argument.
//
// Callers apply a deterministic rename FIRST and treat this as a refinement, so
// a slow or failing endpoint degrades to "renamed but not rewritten" rather
// than leaving the brief on the old brand.
// ----------------------------------------------------------------------------

const PROMPT_API = import.meta.env.VITE_PROMPT_API;

export const suggestBriefPrompt = async ({
  prompt,
  brandName,
  brandDescription,
  product,
  creativeType,
  userId,
  signal,
}) => {
  const base = String(prompt || '').trim();
  const brand = String(brandName || '').trim();
  if (!PROMPT_API || !base || !brand) return '';

  const details = [
    brandDescription ? `Brand description: ${brandDescription}` : '',
    product ? `Product: ${product}` : '',
    creativeType ? `Creative type: ${String(creativeType).replace(/_/g, ' ')}` : '',
  ]
    .filter(Boolean)
    .join('. ');

  const instruction =
    `${base}\n\n` +
    `Rewrite the brief above so it is entirely about ${brand}. ${details}. ` +
    `Keep the same visual direction, tone and length, but replace every detail ` +
    `that belonged to the previous brand with one that fits ${brand}. ` +
    `Return only the rewritten brief.`;

  const { data } = await axios.post(
    PROMPT_API,
    { user_id: userId, prompt: instruction, type: 'image' },
    { headers: { Authorization: `Bearer ${getCookies()}` }, signal },
  );
  return String(data?.suggested_prompt || '').trim();
};
