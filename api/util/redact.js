// /api/util/redact.js
export function redact(text = "") {
  try {
    // Strip query strings + hashes: https://foo?bar -> https://foo
    text = text.replace(/https?:\/\/[^\s?#]+(\?[^\s#]*)?(#[^\s]*)?/gi, (m) => m.split(/[?#]/)[0]);
    // Mask emails
    text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
    // Mask long numbers (e.g., IDs)
    text = text.replace(/\b\d{6,}\b/g, "[redacted-num]");
  } catch {}
  return text;
}
