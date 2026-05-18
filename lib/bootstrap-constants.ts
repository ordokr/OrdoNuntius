// Shared between the server-side payload builder
// (`lib/admin/bootstrap-payload.ts`) and the client-side consumer
// (`hooks/use-config.ts`). Keeping these two literals in one
// dependency-free file prevents the client bundle from pulling in
// configManager / hasSessionSecret / etc. just to read the script
// tag's `id`.

export const BOOTSTRAP_SCRIPT_ID = "__ORDO_BOOTSTRAP__";

// JSON `</script>` would close the wrapping <script> tag in HTML
// regardless of context; escape any literal `<` so the inlined
// payload can't break out of its container. JSON has no semantic
// difference between `<` and `<`; the consumer parses with
// JSON.parse which restores it.
export function serializeForScriptTag(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}
