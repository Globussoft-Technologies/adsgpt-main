const BRANDIQ_ENDPOINT = import.meta.env.VITE_AD_FACTORY_WEB_URL_AUTOFILL;

export const BRAND_IQ_FAILURE_MESSAGE = 'Website fetching failed. Please add manually.';

export async function fetchBrandIq(websiteUrl, signal) {
  let response;
  try {
    response = await fetch(BRANDIQ_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ website_url: websiteUrl }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(BRAND_IQ_FAILURE_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(BRAND_IQ_FAILURE_MESSAGE);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(BRAND_IQ_FAILURE_MESSAGE);
  }
}

export const EMPTY_BRAND_IQ_RESPONSE = {
  brandInfo: {
    brandName: '',
    brandDescription: '',
    brandLogo: [],
    brandImages: [],
    category: '',
    brandVoice: [],
    brandGuidelines: {
      toneOfVoice: '',
      dos: [],
      donts: [],
      colorPalette: [],
    },
  },
  objectives: {
    primaryObjective: '',
    coreIdea: '',
    additionalGuidelines: '',
    targetAudience: [],
  },
};
