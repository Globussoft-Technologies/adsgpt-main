const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || 'G-Q3XPKCQXVP';
const API_SECRET = process.env.GA4_API_SECRET || '';

/**
 * Sanitize event parameters to prevent transmitting PII, credentials,
 * raw prompts, generated text, media URLs, or stack traces.
 */
const sanitizeBackendParams = (params = {}) => {
  const clean = { ...params };

  // Scrub sensitive keys
  delete clean.user_name;
  delete clean.userName;
  delete clean.email;
  delete clean.prompt;
  delete clean.rawPrompt;
  delete clean.raw_prompt;
  delete clean.generatedContent;
  delete clean.generated_content;
  delete clean.mediaUrl;
  delete clean.media_url;
  delete clean.imageUrl;
  delete clean.image_url;
  delete clean.videoUrl;
  delete clean.video_url;
  delete clean.accessToken;
  delete clean.access_token;
  delete clean.token;
  delete clean.refreshToken;
  delete clean.stack;
  delete clean.stackTrace;
  delete clean.stack_trace;
  delete clean.rawError;
  delete clean.raw_error;

  // Format error_code to safe string/code if present
  if (clean.error_code && typeof clean.error_code !== 'string' && typeof clean.error_code !== 'number') {
    clean.error_code = String(clean.error_code);
  }

  return clean;
};

/**
 * Send authoritative business event to GA4 via Measurement Protocol.
 * Non-blocking: errors are logged or swallowed so API operations are never affected.
 */
const trackBackendGA4Event = async (eventName, params = {}) => {
  try {
    const userId = params.user_id || params.userId || null;
    const clientId = params.anonymous_id || (userId ? `usr_${userId}` : `backend_${uuidv4().substring(0, 8)}`);

    const sanitizedParams = sanitizeBackendParams({
      event_id: params.event_id || `evt_${uuidv4().substring(0, 8)}_${Date.now()}`,
      occurred_at: params.occurred_at || new Date().toISOString(),
      user_id: userId ? String(userId) : 'anonymous',
      anonymous_id: clientId,
      session_id: params.session_id || 'backend_session',
      flow_id: params.flow_id || 'none',
      source: 'backend',
      feature: params.feature || 'system',
      flow_version: params.flow_version || 'v1',
      platform: params.platform || 'system',
      asset_type: params.asset_type || 'none',
      duration_ms: params.duration_ms !== undefined ? params.duration_ms : 0,
      success: params.success !== undefined ? params.success : true,
      error_code: params.error_code || 'none',
      ...params,
    });

    const payload = {
      client_id: clientId,
      ...(userId ? { user_id: String(userId) } : {}),
      events: [
        {
          name: eventName,
          params: sanitizedParams,
        },
      ],
    };

    let url = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}`;
    if (API_SECRET) {
      url += `&api_secret=${API_SECRET}`;
    }

    // Fire and forget
    axios.post(url, payload, { timeout: 4000 }).catch(() => {
      /* Silently swallow network / API secret errors */
    });
  } catch (err) {
    /* Silently swallow setup / parse errors */
  }
};

module.exports = {
  trackBackendGA4Event,
};
