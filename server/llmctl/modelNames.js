/**
 * Global modelId → display-name map (config/llm-model-names.json).
 *
 * Single source of naming truth for the whole dashboard: LLM cards, overview
 * chips, token totals, bench headers and the service control page all render
 * the display name while keeping the raw served modelId as tooltip/secondary.
 * Missing entries fall back to the raw id.
 *
 * The file lives on the config volume (survives restarts) and is re-read when
 * its mtime changes, so edits apply without touching the process.
 */

import fs from "fs";
import { LLM_MODEL_NAMES_JSON_PATH } from "../config.js";

let cache = /** @type {Record<string, string> | null} */ (null);
let cacheErr = /** @type {string | null} */ (null);
let mtimeMs = -1;

/**
 * Load (or reload when the file changed) and return the mapping.
 * On read/parse failure the previous mapping is kept and the error is
 * reported once via lastError.
 *
 * @returns {Record<string, string>}
 */
export function getModelNames() {
  try {
    const stat = fs.statSync(LLM_MODEL_NAMES_JSON_PATH);
    if (cache && stat.mtimeMs === mtimeMs) return cache;
    const raw = JSON.parse(fs.readFileSync(LLM_MODEL_NAMES_JSON_PATH, "utf8"));
    const names = raw?.names && typeof raw.names === "object" ? raw.names : {};
    // Sanitize: string keys and values only.
    const clean = {};
    for (const [id, name] of Object.entries(names)) {
      if (typeof id === "string" && id && typeof name === "string" && name) {
        clean[id] = name;
      }
    }
    cache = clean;
    cacheErr = null;
    mtimeMs = stat.mtimeMs;
  } catch (err) {
    // Missing file is fine (no mapping configured); anything else is reported.
    if (cacheErr !== err.message) {
      console.warn(`[llm-model-names] ${err.message}`);
      cacheErr = err.message;
    }
    if (!cache) cache = {};
  }
  return cache;
}

/** Resolve a display name; falls back to the raw modelId. */
export function modelDisplayName(modelId) {
  if (!modelId) return modelId;
  const names = getModelNames();
  return names[modelId] || modelId;
}

/** Last load error, for diagnostics endpoints/tests. */
export function modelNamesError() {
  return cacheErr;
}
