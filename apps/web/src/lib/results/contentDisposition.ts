// Phase 16: Content-Disposition builder for artifact downloads (RFC 6266/5987).
// Header-injection safe: the ASCII fallback drops control chars (incl. CR/LF)
// and neutralizes quotes/backslash, and filename* percent-encodes the UTF-8
// name so non-ASCII filenames (e.g. agent names) survive without corrupting the
// header. Pure / no I/O for unit testing.

function asciiFallback(filename: string): string {
  let out = '';
  for (const ch of filename) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue; // control chars: CR, LF, TAB, DEL…
    if (ch === '"' || ch === '\\') {
      out += '_';
      continue;
    }
    if (code > 0x7e) {
      out += '_'; // non-ASCII → placeholder (real name carried by filename*)
      continue;
    }
    out += ch;
  }
  out = out.trim();
  return out.length > 0 ? out : 'download';
}

// RFC 5987 value-chars: percent-encode everything encodeURIComponent leaves but
// that the grammar disallows ( * ' ( ) ). The rest it leaves ( ! - . _ ~ ) are
// valid attr-chars.
function rfc5987Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `attachment; filename="<ascii>"; filename*=UTF-8''<percent-encoded>`. */
export function attachmentContentDisposition(filename: string): string {
  const ascii = asciiFallback(filename);
  // Keep the two forms consistent. asciiFallback returns the 'download' sentinel
  // only when the name has no usable content (empty / whitespace / control-only);
  // in that case encode 'download' for filename* too, rather than emitting an
  // empty or whitespace-only RFC 5987 value. (A file literally named "download"
  // encodes to the same string, so this branch is always correct.)
  const star = rfc5987Encode(ascii === 'download' ? 'download' : filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}
