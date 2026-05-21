export function getAdText(text) {
  if (text?.includes('Primary Text')) {
    return text
      .replace(/\*\*Primary Text:\*\*/g, '')
      .replace(/Primary Text:/g, '')
      .replace(/\*\*Headline:\*\*/g, '')
      .replace(/Headline:/g, '')
      .replace(/\s+/g, ' ')
      .replace(/Ad Copy \d+:\s*/gm, '')
      .trim();
  } else if (text?.includes('Headline 1')) {
    return text
      .replace(/Headline \d+: /gm, '')
      .replace(/Description \d+: /gm, '')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  } else if (text?.includes('Ad Copy 1:')) {
    return text
      .replace(/Ad Copy \d+:\s*/gm, '')
      .replace(/Introductory Text:\s*/gm, '')
      .replace(/Headline:\s*/gm, '')
      .replace(/Description:\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return text
    ?.replace(/Headline:/g, '')
    .replace(/Description:/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\*\*/g, '')
    .trim();
}
