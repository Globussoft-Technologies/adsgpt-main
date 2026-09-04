export function isVideoModelBlocked(model, userData) {
  const planId = Object.keys(userData?.userSubscriptionType || {})[0];
  return Boolean(planId && model?.blockedPlanIds?.includes(String(planId)));
}

export function getFirstAvailableVideoModel(models, userData) {
  const model = (models || []).find((entry) =>
    (entry?.canonical || entry?.model || entry?.value) && !isVideoModelBlocked(entry, userData)
  );

  return model?.canonical || model?.model || model?.value || '';
}
