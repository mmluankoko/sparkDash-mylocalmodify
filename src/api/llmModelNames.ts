/**
 * Global modelId → display-name store.
 *
 * The mapping lives in config/llm-model-names.json (server-side) and is served
 * by GET /api/llm-model-names. This module caches it client-side and exposes a
 * tiny subscribable store so every LLM surface (cards, chips, token totals,
 * bench dialogs, service control) renders the same display name while keeping
 * the raw served modelId as tooltip/secondary text.
 *
 * Unknown ids fall through to the raw id — never invent names.
 */

let names: ModelNames = {};
const listeners = new Set<() => void>();
let version = 0;

type ModelNames = Record<string, string>;

/** Load the mapping once (idempotent); safe to call again to refresh. */
export async function loadLlmModelNames(): Promise<void> {
  try {
    const res = await fetch("/api/llm-model-names");
    if (!res.ok) return;
    const body = (await res.json()) as { names?: ModelNames };
    if (body.names && typeof body.names === "object") {
      names = body.names;
      version += 1;
      listeners.forEach((l) => l());
    }
  } catch {
    /* offline or not configured — fall back to raw ids */
  }
}

/** Raw mapping (display names by modelId). */
export function getLlmModelNames(): ModelNames {
  return names;
}

/** Resolve a display name; unknown ids fall back to the raw modelId. */
export function llmDisplayName(modelId: string | null | undefined): string {
  if (!modelId) return "";
  return names[modelId] || modelId;
}

/** Bump counter for useSyncExternalStore — changes only when names change. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getVersion(): number {
  return version;
}

export { subscribe as subscribeLlmModelNames, getVersion as getLlmModelNamesVersion };
