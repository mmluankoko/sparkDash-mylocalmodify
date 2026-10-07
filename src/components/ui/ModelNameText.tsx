/**
 * ModelName — renders the global display name for a served modelId, with an
 * inline subscription so already-mounted views re-render when the mapping
 * loads. Unknown ids fall back to the raw modelId.
 *
 * Usage: keep the raw id available as a tooltip on the wrapping element.
 */
import { useSyncExternalStore } from "react";
import {
  llmDisplayName,
  subscribeLlmModelNames,
  getLlmModelNamesVersion,
} from "../../api/llmModelNames";

export function ModelNameText({ id }: { id: string | null | undefined }) {
  useSyncExternalStore(subscribeLlmModelNames, getLlmModelNamesVersion);
  return <>{llmDisplayName(id)}</>;
}
