const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
} as const;

// Module-scope regexes — avoid recompilation per paragraph / per call.
const HTML_ESCAPE_REGEX = /[&<>"']/g;
const CRLF_REGEX = /\r\n?/g;
const PARAGRAPH_SPLIT_REGEX = /\n{2,}/;
const NEWLINE_REGEX = /\n/g;

function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_REGEX, (char) =>
    HTML_ESCAPE_MAP[char as keyof typeof HTML_ESCAPE_MAP]
  );
}

export function plainTextToComposerBody(text: string): string {
  if (!text) return "";

  // Single push loop avoids the .map() intermediate array allocation.
  const paragraphs = text.replace(CRLF_REGEX, "\n").split(PARAGRAPH_SPLIT_REGEX);
  let result = "";
  for (let i = 0; i < paragraphs.length; i++) {
    result += `<p>${escapeHtml(paragraphs[i]).replace(NEWLINE_REGEX, "<br>")}</p>`;
  }
  return result;
}
