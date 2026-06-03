// Phase 17: pure decode helper for the bounded artifact preview. The preview
// route reads only a byte budget from disk (never the whole file); this helper
// turns those bytes into a safe text preview.
//
// Two truncation sources are folded into one `truncated` flag:
//   - byte-budget exceeded (the route signals this via `hadMore`), and
//   - char cap exceeded after decode (`maxChars`).
// When the source was cut at an arbitrary byte boundary (`hadMore === true`), the
// trailing bytes may be an incomplete UTF-8 sequence; we drop them so the preview
// never contains a U+FFFD artifact from boundary damage. A complete file
// (`hadMore === false`) is decoded as-is.

export interface PreviewDecodeResult {
  preview: string;
  truncated: boolean;
}

// Length (in bytes) of `buf` up to the last COMPLETE UTF-8 code point. If the
// buffer ends mid-sequence, the incomplete lead + continuation bytes are excluded.
// Only meaningful for a byte-truncated buffer; a complete file is decoded whole.
function completeUtf8Length(buf: Buffer): number {
  let i = buf.length;
  let cont = 0;
  // Walk back over continuation bytes (10xxxxxx); a code point has at most 3.
  // `i > 0` guarantees the index is in-bounds (non-null assertion is safe).
  while (i > 0 && (buf[i - 1]! & 0xc0) === 0x80 && cont < 3) {
    i--;
    cont++;
  }
  if (i === 0) return buf.length; // all-continuation (corrupt); leave as-is
  const lead = buf[i - 1]!;
  let needed: number;
  if ((lead & 0x80) === 0) needed = 1; // 0xxxxxxx ASCII
  else if ((lead & 0xe0) === 0xc0) needed = 2; // 110xxxxx
  else if ((lead & 0xf0) === 0xe0) needed = 3; // 1110xxxx
  else if ((lead & 0xf8) === 0xf0) needed = 4; // 11110xxx
  else return buf.length; // invalid lead byte; leave as-is (becomes U+FFFD)
  const have = cont + 1;
  return have >= needed ? buf.length : i - 1; // drop incomplete trailing sequence
}

export function decodePreview(
  buf: Buffer,
  hadMore: boolean,
  maxChars: number,
): PreviewDecodeResult {
  const usable = hadMore ? buf.subarray(0, completeUtf8Length(buf)) : buf;
  const text = usable.toString('utf8');
  if (maxChars >= 0 && text.length > maxChars) {
    return { preview: text.slice(0, maxChars), truncated: true };
  }
  return { preview: text, truncated: hadMore };
}
