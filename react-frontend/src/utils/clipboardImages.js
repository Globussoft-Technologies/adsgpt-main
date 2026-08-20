export function getClipboardImageFiles(clipboardData, maxFiles = Infinity) {
  const items = Array.from(clipboardData?.items || []);
  const files = items
    .filter((item) => item.kind === 'file' && item.type?.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  return Number.isFinite(maxFiles) ? files.slice(0, maxFiles) : files;
}
