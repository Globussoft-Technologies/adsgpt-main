/** Client-side mirror of backend config/googleWizardDestinations.js (fallback when schema not loaded). */

export const OBJECTIVE_DESTINATIONS_FALLBACK = {
  SALES:           ['SEARCH', 'PERFORMANCE_MAX', 'SHOPPING'],
  LEADS:           ['SEARCH', 'PERFORMANCE_MAX', 'DISPLAY'],
  WEBSITE_TRAFFIC: ['SEARCH', 'DISPLAY', 'PERFORMANCE_MAX', 'YOUTUBE_REACH'],
  APP_PROMOTION:   ['APP_PROMOTION'],
  LOCAL_STORE:     ['SEARCH', 'PERFORMANCE_MAX'],
  YOUTUBE_REACH:   ['YOUTUBE_REACH'],
};

const CHANNEL_TYPES = new Set([
  'SEARCH', 'DISPLAY', 'SHOPPING', 'PERFORMANCE_MAX',
  'VIDEO', 'DEMAND_GEN', 'MULTI_CHANNEL', 'YOUTUBE_REACH', 'APP_PROMOTION',
]);

export function getObjectiveDestinationsMap(schema) {
  return schema?.objectiveDestinations || OBJECTIVE_DESTINATIONS_FALLBACK;
}

export function getDestinationsForObjective(objective, schema, allDestinations = []) {
  const map = getObjectiveDestinationsMap(schema);
  const key = String(objective || '').toUpperCase().replace(/ /g, '_');
  const allowed = map[key] || [];
  if (!allowed.length) return [];
  const catalog = allDestinations.length ? allDestinations : allowed.map((value) => ({ value }));
  return allowed
    .map((value) => catalog.find((d) => d.value === value) || { value, label: value })
    .filter(Boolean);
}

export function isAllowedDestination(objective, destination, schema) {
  const map = getObjectiveDestinationsMap(schema);
  const key = String(objective || '').toUpperCase().replace(/ /g, '_');
  const dest = String(destination || '').toUpperCase().replace(/ /g, '_');
  return (map[key] || []).includes(dest);
}

/** Normalize campaign table context (channel-only objective) into wizard form fields. */
export function normalizeWizardContext(context = {}) {
  if (!context) return context;
  if (context.destination) return context;

  const ch = String(context.objective || '').toUpperCase().replace(/ /g, '_');
  if (!ch || !CHANNEL_TYPES.has(ch)) return context;

  const objectiveByChannel = {
    SEARCH: 'WEBSITE_TRAFFIC',
    DISPLAY: 'WEBSITE_TRAFFIC',
    SHOPPING: 'SALES',
    PERFORMANCE_MAX: 'SALES',
    YOUTUBE_REACH: 'YOUTUBE_REACH',
    VIDEO: 'YOUTUBE_REACH',
    DEMAND_GEN: 'YOUTUBE_REACH',
    MULTI_CHANNEL: 'APP_PROMOTION',
    APP_PROMOTION: 'APP_PROMOTION',
  };

  return {
    ...context,
    objective: objectiveByChannel[ch] || context.objective,
    destination: ch === 'MULTI_CHANNEL' ? 'APP_PROMOTION' : ch,
  };
}

export function destinationLabel(destination, schema, objectives = []) {
  const dest = schema?.destinations?.find((d) => d.value === destination);
  if (dest?.label) return dest.label;
  const fromObj = objectives.flatMap((o) => o.destinations || []).find((d) => d.value === destination);
  return fromObj?.label || destination;
}

export function objectiveLabel(objective, objectives = []) {
  return objectives.find((o) => o.value === objective)?.label || objective;
}
