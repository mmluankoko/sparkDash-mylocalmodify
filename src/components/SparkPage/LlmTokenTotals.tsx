/**
 * LlmTokenTotals — per-model cumulative prompt/completion token table.
 * Local-only component: lives in its own file, rendered by LlmPanel via one
 * anchor line + one import line (see docs/LOCAL-MODS.md).
 */
import { t, useI18n } from "../../i18n";
import { useEffect, useState } from "react";
import { fetchLlmTokenTotals } from "../../api/llmTokenClient";
import { formatTokensCompact } from "../../shared/tokenFormat";
import { formatSince } from "../../shared/formatSince";
import type { LlmTokenRange, LlmTokenSeriesTotals } from "../../api/llmTokenTypes";
import { LEDGER_HINT, LEDGER_TITLE } from "./tokenTotalsCopy";

const POLL_MS = 60_000;

const RANGE_OPTIONS: Array<{ value: LlmTokenRange; label: () => string }> = [
  { value: "all", label: () => t("All time") },
  { value: "today", label: () => t("Today") },
  { value: "7d", label: () => t("Last 7 days") },
  { value: "14d", label: () => t("Last 14 days") },
  { value: "30d", label: () => t("Last month") },
];

export function LlmTokenTotals({ sparkId, llmPort }: { sparkId: string; llmPort: number }) {
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
  }, [sparkId, llmPort, range]);

  if (!series || series.length === 0) return null;

  const rows = series
    .filter((s) => s.sparkId === sparkId && s.port === llmPort)
    .flatMap((s) => s.models);

  if (rows.length === 0 && range === "all") return null;

  return (
    <div className="border-t border-border pt-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0" title={t(LEDGER_TITLE)}>
          <span className="block text-[10px] uppercase tracking-wide text-muted">
            {t("Total tokens by model")}
          </span>
          <span className="block text-[10px] text-muted">{t(LEDGER_HINT)}</span>
        </span>
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as LlmTokenRange)}
            aria-label={t("Token totals time range")}
            className="rounded border border-border bg-surface-elevated text-text"
            style={{ height: "20px", padding: "0 4px", fontSize: "9px", width: "auto" }}
          >
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label()}
              </option>
            ))}
          </select>
          <span className="shrink-0 whitespace-nowrap text-[10px] text-muted">
            <span className="inline-block w-14 text-right">{t("Cached")}</span>

            <span className="inline-block w-14 text-right">{t("Prefill")}</span>

            <span className="inline-block w-16 text-right">{t("Generated")}</span>
          </span>
        </div>
      </div>
      <div className="space-y-1">
        {rows.length === 0 ? (
          <p className="text-[11px] text-muted">{t("No tokens recorded in this period.")}</p>
        ) : (
          rows.map((row) => {
          const seen = formatSince(row.lastSeenAt);
          return (
            <div
              key={row.modelId}
              className="flex items-center justify-between gap-2 text-[11px]"
              title={t(
                "{0} prompt · {1} cached · {2} prefill · {3} generated{4}",
                row.promptTokens.toLocaleString(),
                row.cachedTokens.toLocaleString(),
                (row.promptTokens - row.cachedTokens).toLocaleString(),
                row.completionTokens.toLocaleString(),
                seen ? ` · ${seen} ${t("ago")}` : ""
              )}
            >
              <span
                className="min-w-0 flex-1 truncate text-text"
                title={row.modelId}
              >
                {row.modelId}
              </span>
              <span className="shrink-0 font-tabular text-muted">
                <span className="inline-block w-14 text-right">
                  {row.cachedTokens > 0 ? formatTokensCompact(row.cachedTokens) : "—"}
                </span>

                <span className="inline-block w-14 text-right">
                  {formatTokensCompact(row.promptTokens - row.cachedTokens)}
                </span>

                <span className="inline-block w-16 text-right text-text">
                  {formatTokensCompact(row.completionTokens)}
                </span>
              </span>
            </div>
          );
        })
        )}
      </div>
    </div>
  );
}
