// Pure display helper (Phase 12): truncate a large attempt output for preview.
// The full text stays in the DB (source of truth); this only caps what the UI
// renders by default, with "Show full text" revealing the rest.

export interface PreviewResult {
  preview: string;
  truncated: boolean;
  totalChars: number;
}

export function truncateForPreview(text: string, maxChars: number): PreviewResult {
  const totalChars = text.length;
  if (maxChars < 0 || totalChars <= maxChars) {
    return { preview: text, truncated: false, totalChars };
  }
  return { preview: text.slice(0, maxChars), truncated: true, totalChars };
}
