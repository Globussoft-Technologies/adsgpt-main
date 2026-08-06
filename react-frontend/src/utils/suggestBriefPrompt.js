import axios from 'axios';
import getCookies from '@/utils/getCookies';

// ----------------------------------------------------------------------------
// Rewrite a creative brief's prompt for a newly chosen brand.
//
// Renaming the brand inside the prompt was never enough: every other sentence
// still described the previous brand's product, tone and audience. Brands are
// too different for a template to carry, so the rewrite is done by a model.
//
// This calls the AGENT (POST /brief/rewrite-prompt), not Ad Studio's
// prompt-improve endpoint. That one needs its own VITE_PROMPT_API env var —
// absent on an environment it silently did nothing, leaving the brief on the
// old brand — and it takes no brand argument, so the brand context had to be
// smuggled into the prompt text. The agent route shares the assistant's own
// base URL and JWT, so there is nothing extra to configure.
//
// The agent never fails this call: on any model error it returns the ORIGINAL
// prompt with rewritten:false, so the card keeps the deterministic rename that
// already landed rather than losing the brief.
// ----------------------------------------------------------------------------

// Same base the rest of the assistant uses (apis/aiAssistant/aiAssistantApi.js).
const BASE_URL = import.meta.env.VITE_AGENTIC_URL;

export const suggestBriefPrompt = async ({
  prompt,
  brandName,
  brandDescription,
  product,
  creativeType,
  previousBrand,
  signal,
}) => {
  const base = String(prompt || '').trim();
  const brand = String(brandName || '').trim();
  if (!BASE_URL || !base || !brand) return '';

  const { data } = await axios.post(
    `${BASE_URL}/brief/rewrite-prompt`,
    {
      prompt: base,
      brand_name: brand,
      brand_description: String(brandDescription || '').slice(0, 4000),
      product: String(product || '').slice(0, 300),
      creative_type: String(creativeType || ''),
      // Naming the outgoing brand lets the agent tell the model exactly what
      // NOT to carry over — without it, a Nike brief became Nvidia-branded
      // trainers instead of a brief about graphics cards.
      previous_brand: String(previousBrand || '').slice(0, 200),
    },
    { headers: { Authorization: `Bearer ${getCookies()}` }, signal },
  );

  // Only report a genuine rewrite; `prompt` echoes the original otherwise and
  // re-applying it would pointlessly churn the textarea.
  return data?.rewritten ? String(data.prompt || '').trim() : '';
};
