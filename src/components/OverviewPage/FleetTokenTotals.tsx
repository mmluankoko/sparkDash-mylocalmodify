import { AppLink } from "../ui/AppLink";
import { TOKENS_ID, idToPath } from "../../constants";
/**
 * FleetTokenTotals — Overview section with cumulative prompt/completion tokens
 * aggregated across all Sparks, grouped by model, plus a fleet-wide total.
 * Local-only component: own file + one import line and one render line in
 * OverviewPage (see docs/LOCAL-MODS.md).
 */
import { t, useI18n } from "../../i18n";
import { useEffect, useState } from "react";
import { fetchLlmTokenTotals } from "../../api/llmTokenClient";
import { addTokens, formatTokensCompact } from "../../shared/tokenFormat";
import { ModelNameText } from "../ui/ModelNameText";
import type { LlmTokenRange, LlmTokenSeriesTotals } from "../../api/llmTokenTypes";
import { LEDGER_HINT, LEDGER_TITLE } from "../SparkPage/tokenTotalsCopy";

const POLL_MS = 60_000;

const RANGE_OPTIONS: Array<{ value: LlmTokenRange; label: () => string }> = [
  { value: "all", label: () => t("All time") },
  { value: "today", label: () => t("Today") },
  { value: "7d", label: () => t("Last 7 days") },
  { value: "14d", label: () => t("Last 14 days") },
  { value: "30d", label: () => t("Last month") },
];

/** Aggregate per-series model rows into one fleet-wide per-model table. */
export function aggregateModelTotals(
  series: LlmTokenSeriesTotals[]
): {
  rows: Array<{ modelId: string; promptTokens: number; cachedTokens: number; completionTokens: number; sparkCount: number }>;
  totalPrompt: number;
  totalCached: number;
  totalCompletion: number;
} {
  const byModel = new Map<
    string,
    { promptTokens: number; cachedTokens: number; completionTokens: number; sparks: Set<string> }
  >();
  let totalPrompt = 0;
  let totalCached = 0;
  let totalCompletion = 0;
  for (const s of Array.isArray(series) ? series : []) {
    for (const row of Array.isArray(s.models) ? s.models : []) {
      const entry =
        byModel.get(row.modelId) ??
        { promptTokens: 0, cachedTokens: 0, completionTokens: 0, sparks: new Set<string>() };
      entry.promptTokens = addTokens(entry.promptTokens, row.promptTokens || 0);
      entry.cachedTokens = addTokens(entry.cachedTokens, row.cachedTokens || 0);
      entry.completionTokens = addTokens(entry.completionTokens, row.completionTokens || 0);
      entry.sparks.add(s.sparkId);
      byModel.set(row.modelId, entry);
      totalPrompt = addTokens(totalPrompt, row.promptTokens || 0);
      totalCached = addTokens(totalCached, row.cachedTokens || 0);
      totalCompletion = addTokens(totalCompletion, row.completionTokens || 0);
    }
  }
  const rows = [...byModel.entries()]
    .map(([modelId, entry]) => ({
      modelId,
      promptTokens: entry.promptTokens,
      cachedTokens: Math.min(entry.cachedTokens, entry.promptTokens),
      completionTokens: entry.completionTokens,
      sparkCount: entry.sparks.size,
    }))
    .sort(
      (a, b) =>
        b.completionTokens + b.promptTokens - (a.completionTokens + a.promptTokens)
    );
  return { rows, totalPrompt, totalCached: Math.min(totalCached, totalPrompt), totalCompletion };
}

export function FleetTokenTotals({ onOpenDetails }: { onOpenDetails?: () => void }) {
  useI18n();
  const [series, setSeries] = useState<LlmTokenSeriesTotals[] | null>(null);
  const [range, setRange] = useState<LlmTokenRange>("all");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchLlmTokenTotals(range)
        .then((res) => {
          if (!cancelled) setSeries(res.series || []);
        })
        .catch(() => {
          if (!cancelled) setSeries([]);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [range]);

  if (!series || series.length === 0) return null;

  const { rows, totalPrompt, totalCached, totalCompletion } = aggregateModelTotals(series);
  // Count only endpoints with token data in the selected period, not all configured ones.
  const activeEndpoints = series.filter((s) => s.models.length > 0).length;
  if (rows.length === 0 && range === "all") return null;

  const prefillComputed = Math.max(0, totalPrompt - totalCached);
  const grand = Math.max(1, totalCompletion + totalCached + prefillComputed);
  const pct = (n: number) => `${((n / grand) * 100).toFixed(1)}%`;

  return (
    <section className="panel ov-card" aria-labelledby="fleet-token-totals-title">
      <div className="ov-card__head">
        <h2 id="fleet-token-totals-title" className="ov-card__title">{t("LLM Token Totals")}</h2>
        <div className="ov-card__tools">
          <span className="tag">
            {activeEndpoints} {activeEndpoints === 1 ? t("endpoint") : t("endpoints")}
          </span>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as LlmTokenRange)}
            aria-label={t("Token totals time range")}
            className="ov-select"
          >
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label()}
              </option>
            ))}
          </select>
          {onOpenDetails ? (
            <AppLink href={idToPath(TOKENS_ID)} className="btn btn--sm btn--ghost" onNavigate={onOpenDetails}>
              Details
            </AppLink>
          ) : null}
        </div>
      </div>
      <div>
        <div className="big-num">
          {formatTokensCompact(totalCompletion)}
          <small>{t("generated")}</small>
        </div>
        <div className="ov-card__sub" title={t(LEDGER_TITLE)}>
          {t(LEDGER_HINT)}, {t("whole fleet")}
        </div>
      </div>
      <div className="seg-bar" role="img" aria-label="Generated, cached prefill and computed prefill token share">
        <i className="ov-seg ov-seg--gen" style={{ width: pct(totalCompletion) }} />
        <i className="ov-seg ov-seg--cached" style={{ width: pct(totalCached) }} />
        <i className="ov-seg ov-seg--comp" style={{ width: pct(prefillComputed) }} />
      </div>
      <div className="legend">
        <span className="ov-leg--gen">Generated</span>
        <span className="ov-leg--cached">Cached</span>
        <span className="ov-leg--comp">Prefill</span>
      </div>
      <div className="ov-rows">
        <div className="ov-row ov-row--head">
          <span className="ov-row__name eyebrow">Model</span>
          <span className="ov-row__num eyebrow">Cached</span>
          <span className="ov-row__num eyebrow">Prefill</span>
          <span className="ov-row__num eyebrow">Gen</span>
        </div>
        {rows.length === 0 ? (
          <p className="ov-card__sub">{t("No tokens recorded in this period.")}</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.modelId}
              className="ov-row"
              title={t(
                "{0} prompt · {1} cached · {2} prefill · {3} generated · {4} {5}",
                row.promptTokens.toLocaleString(),
                row.cachedTokens.toLocaleString(),
                (row.promptTokens - row.cachedTokens).toLocaleString(),
                row.completionTokens.toLocaleString(),
                row.sparkCount,
                row.sparkCount === 1 ? t("Spark") : t("Sparks")
              )}
            >
              <span className="ov-row__name" title={row.modelId}>
                <ModelNameText id={row.modelId} />
                {row.sparkCount > 1 && <span className="ov-row__x">{"\u00d7"}{row.sparkCount}</span>}
              </span>
              <span className="ov-row__num mono">{row.cachedTokens > 0 ? formatTokensCompact(row.cachedTokens) : "\u2014"}</span>
              <span className="ov-row__num mono">{formatTokensCompact(row.promptTokens - row.cachedTokens)}</span>
              <span className="ov-row__num ov-row__num--strong mono">{formatTokensCompact(row.completionTokens)}</span>
            </div>
          ))
        )}
        <div className="ov-row ov-row--total">
          <span className="ov-row__name eyebrow">{t("Total")}</span>
          <span className="ov-row__num mono">{totalCached > 0 ? formatTokensCompact(totalCached) : "\u2014"}</span>
          <span className="ov-row__num mono">{formatTokensCompact(prefillComputed)}</span>
          <span className="ov-row__num ov-row__num--strong mono">{formatTokensCompact(totalCompletion)}</span>
        </div>
      </div>
    </section>
  );
}
