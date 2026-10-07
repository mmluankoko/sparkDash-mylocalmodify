import { t, useI18n } from "../../i18n";
import { useEffect, useState } from "react";
import type { SparkSnapshot } from "../../api/types";
import { isWorkerSpark, resolveSparkRole } from "../../api/sparkRole";
import { updateAllHermes } from "../../api/client";
import { MetricBar } from "../ui/MetricBar";
import { ModelNameText } from "../ui/ModelNameText";
import { Sparkline } from "../ui/Sparkline";
import { useMetricsHistoryTail } from "../../hooks/metricsStore";
import { backendLabel } from "../../shared/llmBackends.js";
import { FleetEnergyCard } from "./FleetEnergyCard";
import { FleetAlertStrip } from "./FleetAlertStrip";
import { FleetTokenTotals } from "./FleetTokenTotals";
import { ActivityIcon, RotateIcon } from "../ui/icons";

interface OverviewPageProps {
  sparks: SparkSnapshot[];
  hideOffline?: boolean;
  hideWorkers?: boolean;
  showFleetEnergy?: boolean;
  showFleetExceptions?: boolean;
  showOverviewSearch?: boolean;
  /** Overview LLM token totals card (cumulative tokens per model). */
  showLlmTokenTotals?: boolean;
  temperatureUnit?: "celsius" | "fahrenheit";
  onSelectSpark?: (id: string) => void;
}

function celsiusToFahrenheit(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}



/** Format a storage value in MB, stripping trailing ".0" and optionally omitting the unit. */
function fmtStorage(mb: number, unit: boolean): string {
  const val = mb >= 1024 ? mb / 1024 : mb;
  const label = mb >= 1024 ? "GB" : "MB";
  const s = val.toFixed(1).replace(/\.0$/, "");
  return unit ? `${s} ${label}` : s;
}

function MiniStat({
  label,
  value,
  tone = "default",
  bold = true,
  title,
  wrap = false,
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "warning" | "danger" | "success";
  bold?: boolean;
  title?: string;
  /** Allow value to wrap (no ellipsis trim) — used for long model ids. */
  wrap?: boolean;
}) {
  useI18n();
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "accent"
          ? "text-accent"
          : tone === "success"
            ? "text-success"
            : "text-text";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] tracking-wide text-muted">{label}</span>
      <span
        className={`font-tabular text-[13px] ${
          wrap
            ? "whitespace-normal break-words leading-snug [overflow-wrap:anywhere]"
            : "truncate"
        } ${bold ? "font-semibold" : ""} ${toneClass}`}
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

function SparkCard({
  spark,
  temperatureUnit,
  onSelect,
}: {
  spark: SparkSnapshot;
  temperatureUnit: "celsius" | "fahrenheit";
  onSelect?: (id: string) => void;
}) {
  useI18n();
  const gpu = spark.metrics.gpu;
  const um = spark.metrics.unifiedMemory;
  const online = spark.online;

  const usage = gpu?.usage ?? 0;
  const tempRaw = gpu?.temperature ?? 0;
  const displayTemp = temperatureUnit === "fahrenheit" ? celsiusToFahrenheit(tempRaw) : tempRaw;
  const tempLabel = temperatureUnit === "fahrenheit" ? `${displayTemp}°F` : `${displayTemp}°C`;
  const vramPct = gpu?.vram?.percentage ?? um?.percentage ?? 0;
  const vramUsed = gpu?.vram?.used ?? um?.used ?? 0;
  const vramTotal = gpu?.vram?.total ?? um?.total ?? 0;

  // Temperature bar: cool → success, warm → warning, hot → danger
  const tempBarColor =
    tempRaw > 85 ? "bg-danger" : tempRaw > 65 ? "bg-warning" : tempRaw > 40 ? "bg-accent" : "bg-success";
  // Usage bar: accent for moderate, warning high, danger critical
  const usageBarColor = usage > 85 ? "bg-danger" : usage > 60 ? "bg-warning" : "bg-accent";
  // VRAM allocation: accent normal → warning/danger as it fills
  const vramBarColor = vramPct > 85 ? "bg-danger" : vramPct > 60 ? "bg-warning" : "bg-accent";

  return (
    <div
      className="overview-card flex flex-col"
      style={{
        padding: "var(--density-card-pad)",
        gap: "var(--density-card-gap)",
        ...(online ? {} : { opacity: 0.6 }),
      }}
    >
      {/* Card header */}
      <div className="flex items-center gap-2.5">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-success dot-glow-success" : "bg-danger"}`}
        />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-strong">
          {onSelect ? (
            <button
              type="button"
              onClick={() => onSelect(spark.id)}
              className="text-left font-inherit text-inherit hover:underline"
            >
              {spark.name}
            </button>
          ) : (
            spark.name
          )}
        </span>
        {(() => {
          const role = resolveSparkRole(spark);
          const text =
            role === "head" ? t("Head") : role === "worker" ? t("Worker") : t("Standalone");
          const title =
            role === "head"
              ? t("Cluster head Spark")
              : role === "worker"
                ? spark.workerLabel?.trim()
                  ? t("{0} · distributed LLM worker", spark.workerLabel.trim())
                  : t("Distributed LLM worker")
                : spark.llmMonitoring === false
                  ? t("Standalone — LLM monitoring off")
                  : t("Standalone Spark");
          return (
            <span
              className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent"
              title={title}
            >
              {text}
            </span>
          );
        })()}
        {spark.comfyMonitoring ? (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              !spark.metrics?.comfy?.available
                ? "bg-border/60 text-muted"
                : (spark.metrics.comfy.queueRunning ?? 0) > 0
                  ? "bg-accent/15 text-accent"
                  : (spark.metrics.comfy.queuePending ?? 0) > 0
                    ? "bg-warning/15 text-warning"
                    : "bg-border/60 text-muted"
            }`}
            title={
              !spark.metrics?.comfy?.available
                ? t("ComfyUI monitoring on — not reachable")
                : (spark.metrics.comfy.queueRunning ?? 0) > 0
                  ? spark.metrics.comfy.activeJob?.title
                    ? t("ComfyUI running: {0}", spark.metrics.comfy.activeJob.title)
                    : t("ComfyUI job running")
                  : (spark.metrics.comfy.queuePending ?? 0) > 0
                    ? t("ComfyUI queue: {0} pending", spark.metrics.comfy.queuePending)
                    : t("ComfyUI idle")
            }
          >
            {!spark.metrics?.comfy?.available
              ? "Comfy"
              : (spark.metrics.comfy.queueRunning ?? 0) > 0
                ? t("Comfy · run")
                : (spark.metrics.comfy.queuePending ?? 0) > 0
                  ? t("Comfy · {0}q", spark.metrics.comfy.queuePending)
                  : t("Comfy · idle")}
          </span>
        ) : null}
        <span className="text-[10px] uppercase tracking-wide text-muted">
          {online ? t("online") : t("offline")}
        </span>
      </div>

      {!online || !gpu ? (
        <div className="flex h-[120px] items-center justify-center">
          <span className="text-[13px] text-muted">
            {online ? t("Waiting for metrics…") : t("Host unreachable")}
          </span>
        </div>
      ) : (
        <>
          {/* Headline bars: GPU load, VRAM, GPU temp, CPU load, CPU temp */}
          <div className="flex flex-col gap-3.5">
            <MetricBar
              label={t("GPU Load")}
              value={usage}
              max={100}
              color={usageBarColor}
              caption={`${usage}%`}
            />
            <MetricBar
              label={t("VRAM")}
              value={vramUsed}
              max={vramTotal}
              color={vramBarColor}
              caption={vramTotal > 0 ? `${fmtStorage(vramUsed, false)} / ${fmtStorage(vramTotal, true)}` : "—"}
            />
            {spark.kind === "host" && (() => {
              // Non-Spark hosts: system RAM is separate from discrete VRAM.
              const ram = spark.metrics.ram;
              const rUsed = ram?.used ?? 0;
              const rTotal = ram?.total ?? 0;
              const rPct = rTotal > 0 ? Math.round((rUsed / rTotal) * 100) : 0;
              const ramBarColor = rPct > 85 ? "bg-danger" : rPct > 60 ? "bg-warning" : "bg-accent";
              return (
                <MetricBar
                  label={t("RAM")}
                  value={rUsed}
                  max={rTotal}
                  color={ramBarColor}
                  caption={rTotal > 0 ? `${fmtStorage(rUsed, false)} / ${fmtStorage(rTotal, true)}` : "—"}
                />
              );
            })()}
            <MetricBar
              label={t("GPU Temperature")}
              value={displayTemp}
              max={temperatureUnit === "fahrenheit" ? 176 : 80}
              color={tempBarColor}
              caption={tempLabel}
            />
            {spark.metrics.cpu && spark.metrics.cpu.usage > 0 && (() => {
              const cpuUsage = spark.metrics.cpu?.usage ?? 0;
              const cpuLoadBarColor =
                cpuUsage > 85 ? "bg-danger" : cpuUsage > 60 ? "bg-warning" : "bg-accent";
              return (
                <MetricBar
                  label={t("CPU Load")}
                  value={cpuUsage}
                  max={100}
                  color={cpuLoadBarColor}
                  caption={`${cpuUsage}%`}
                />
              );
            })()}
            {(spark.metrics.cpu?.temperature ?? 0) > 0 && (() => {
              const cpuRaw = spark.metrics.cpu?.temperature ?? 0;
              const cpuDisplay =
                temperatureUnit === "fahrenheit" ? celsiusToFahrenheit(cpuRaw) : cpuRaw;
              const cpuLabel =
                temperatureUnit === "fahrenheit" ? `${cpuDisplay}°F` : `${cpuDisplay}°C`;
              const cpuBarColor =
                cpuRaw > 95 ? "bg-danger" : cpuRaw > 85 ? "bg-warning" : cpuRaw > 50 ? "bg-accent" : "bg-success";
              return (
                <MetricBar
                  label={t("CPU Temperature")}
                  value={cpuDisplay}
                  max={temperatureUnit === "fahrenheit" ? 176 : 80}
                  color={cpuBarColor}
                  caption={cpuLabel}
                />
              );
            })()}
            {gpu?.throttle?.thermal && (
              <div
                className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] font-medium text-danger"
                title={gpu.throttle.detail || t("GPU thermal slowdown engaged")}
              >
                {t("Thermal throttle")}</div>
            )}
          </div>

          {/* Secondary stats: GPU power + CPU power only */}
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-3.5">
            <MiniStat
              label={t("GPU Power")}
              value={`${gpu?.power?.draw ?? 0}W / ${gpu?.power?.limit ?? 0}W`}
            />
            <MiniStat
              label={t("CPU Power")}
              value={
                spark.metrics.cpu && spark.metrics.cpu.tdp > 0
                  ? `${spark.metrics.cpu.draw}W / ${spark.metrics.cpu.tdp}W`
                  : "—"
              }
            />
          </div>

        </>
      )}
    </div>
  );
}

/**
 * Fleet-level LLM stats card — full-width, placed after the node cards.
 * One per head/standalone Spark with a live LLM backend: throughput with
 * sparklines plus engine state, slots, context, KV cache, TTFT and totals.
 */
function LlmStatsCard({
  spark,
  onSelect,
}: {
  spark: SparkSnapshot;
  onSelect?: (id: string) => void;
}) {
  useI18n();
  const llmArr = Array.isArray(spark.metrics?.llm) ? spark.metrics.llm : [];
  const idx = llmArr.findIndex((l) => l.available);
  const port = spark.llmPorts?.[idx] ?? spark.llmPort ?? 8888;
  const genTail = useMetricsHistoryTail(spark.id, `llm:${port}.tps`);
  const prefillTail = useMetricsHistoryTail(spark.id, `llm:${port}.prefill`);
  if (resolveSparkRole(spark) === "worker" || idx < 0) return null;
  const llm = llmArr[idx];
  const engineState =
    llm.gpuMemoryUtilization == null
      ? null
      : llm.gpuMemoryUtilization === 0
        ? { text: t("Sleeping"), cls: "text-muted" }
        : { text: t("Active"), cls: "text-success" };
  const kvPct =
    llm.kvCacheUsage == null
      ? null
      : `${(llm.kvCacheUsage * 100).toFixed(1)}%`;
  return (
    <div
      className="overview-card flex flex-col sm:col-span-2 lg:col-span-3"
      style={{
        padding: "var(--density-card-pad)",
        gap: "var(--density-card-gap)",
      }}
    >
      {/* Header: node · backend · port · engine state · model */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent dot-glow-success" />
        <span className="min-w-0 text-[15px] font-semibold text-text-strong">
          {onSelect ? (
            <button
              type="button"
              onClick={() => onSelect(spark.id)}
              className="text-left font-inherit text-inherit hover:underline"
            >
              {spark.name}
            </button>
          ) : (
            spark.name
          )}
        </span>
        <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
          LLM · {backendLabel(llm.backend) ?? "?"}
        </span>
        <span className="shrink-0 font-tabular text-[10px] text-muted">:{port}</span>
        {engineState && (
          <span className={`shrink-0 text-[10px] uppercase tracking-wide ${engineState.cls}`}>
            ● {engineState.text}
          </span>
        )}
        {llm.modelId && (
          <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted" title={llm.modelId}>
            <ModelNameText id={llm.modelId} />
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] tracking-wide text-muted">{t("Generation tok/s")}</span>
          <div className="flex items-end justify-between gap-2">
            <Sparkline data={genTail} color="var(--color-accent)" height={26} />
            <span className="font-tabular text-[24px] font-bold leading-none text-accent">
              {llm.generationTps.toFixed(0)}
            </span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 border-l border-border pl-2">
          <span className="text-[10px] tracking-wide text-muted">{t("Prefill tok/s")}</span>
          <div className="flex items-end justify-between gap-2">
            <Sparkline data={prefillTail} color="var(--color-text)" height={26} />
            <span className="font-tabular text-[24px] font-bold leading-none text-text-strong">
              {llm.prefillTps.toFixed(0)}
            </span>
          </div>
        </div>
        {llm.cachedPrefillTps != null && (
          <div className="flex min-w-0 flex-col gap-0.5 border-l border-border pl-2">
            <span className="text-[10px] tracking-wide text-muted">{t("Cached prefill tok/s")}</span>
            <span className="font-tabular text-[15px] font-semibold text-muted">
              {llm.cachedPrefillTps.toFixed(0)}
            </span>
          </div>
        )}
        {llm.uncachedPrefillTps != null && (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] tracking-wide text-muted">{t("Uncached prefill tok/s")}</span>
            <span className="font-tabular text-[15px] font-semibold text-text">
              {llm.uncachedPrefillTps.toFixed(0)}
            </span>
          </div>
        )}
      </div>

      {/* Secondary engine stats */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat
          label={t("Slots")}
          value={
            (llm.slotsTotal ?? 0) > 0
              ? `${llm.slotsActive ?? 0} / ${llm.slotsTotal ?? 0}`
              : (llm.slotsActive ?? 0) > 0
                ? String(llm.slotsActive)
                : "—"
          }
          tone={(llm.slotsActive ?? 0) > 0 ? "accent" : "default"}
          bold={false}
        />
        <MiniStat
          label={t("Context")}
          value={llm.contextLength ? llm.contextLength.toLocaleString() : "—"}
          bold={false}
        />
        <MiniStat
          label={t("KV Cache")}
          value={kvPct ?? "—"}
          tone={
            llm.kvCacheUsage == null
              ? "default"
              : llm.kvCacheUsage >= 0.8
                ? "danger"
                : llm.kvCacheUsage >= 0.5
                  ? "warning"
                  : "success"
          }
          bold={false}
        />
        <MiniStat
          label={t("TTFT p95")}
          value={llm.ttftP95Seconds != null ? `${llm.ttftP95Seconds.toFixed(3)}s` : "—"}
          bold={false}
        />
        <MiniStat
          label={t("Total Generated")}
          value={llm.totalOutputTokens > 0 ? llm.totalOutputTokens.toLocaleString() : "—"}
          bold={false}
        />
      </div>
    </div>
  );
}

export function OverviewPage({
  sparks,
  hideOffline = false,
  hideWorkers = false,
  showFleetEnergy = false,
  showFleetExceptions = false,
  showOverviewSearch = false,
  showLlmTokenTotals = false,
  temperatureUnit = "celsius",
  onSelectSpark,
}: OverviewPageProps) {
  useI18n();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline" | "issues">("all");
  const withoutWorkers = hideWorkers ? sparks.filter((s) => !isWorkerSpark(s)) : sparks;
  const visibleSparks = withoutWorkers.filter((spark) => {
    if (hideOffline && !spark.online) return false;
    if (showOverviewSearch && query && !spark.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (showOverviewSearch && statusFilter === "online" && !spark.online) return false;
    if (showOverviewSearch && statusFilter === "offline" && spark.online) return false;
    if (showOverviewSearch && statusFilter === "issues" && spark.online && !spark.metrics.storage.some((disk) => disk.percentage >= 90)) return false;
    return true;
  });
  const hiddenWorkerCount = hideWorkers ? sparks.filter(isWorkerSpark).length : 0;
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMsg, setBatchMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  /** Spark ids we started a batch Hermes update on; drives the live progress bar. */
  const [batchRun, setBatchRun] = useState<string[] | null>(null);

  const hermesMonitoredCount = sparks.filter((s) => s.hermes?.monitoring).length;
  const hermesPendingUpdateCount = sparks.filter((s) => s.hermes?.updateAvailable === true).length;

  // Live batch progress — counted from WS snapshots, not from the one-shot HTTP response.
  const batchProg = (() => {
    if (!batchRun || batchRun.length === 0) return null;
    let done = 0;
    let failed = 0;
    for (const id of batchRun) {
      const h = sparks.find((s) => s.id === id)?.hermes;
      if (!h) continue;
      if (h.status === "error") {
        done += 1;
        failed += 1;
      } else if (h.status === "success" || h.finishedAt != null) {
        done += 1;
      }
    }
    return { total: batchRun.length, done, failed };
  })();

  // Once every started update has settled (success/error), dismiss the progress bar.
  useEffect(() => {
    if (!batchRun || batchRun.length === 0) return;
    const settled = batchRun.reduce((n, id) => {
      const h = sparks.find((s) => s.id === id)?.hermes;
      if (!h) return n;
      return n + (h.status === "success" || h.status === "error" || h.finishedAt != null ? 1 : 0);
    }, 0);
    if (settled === batchRun.length) {
      const t = setTimeout(() => setBatchRun(null), 6000);
      return () => clearTimeout(t);
    }
  }, [batchRun, sparks]);

  async function handleUpdateAllHermes() {
    if (hermesMonitoredCount === 0) return;
    setBatchLoading(true);
    setBatchMsg(null);
    try {
      const res = await updateAllHermes();
      const started = res.results.filter((r) => r.started);
      const skipped = res.results.filter((r) => r.skipped).length;
      const failed = res.results.filter((r) => !r.ok && !r.skipped).length;
      const parts = [`${started.length} update${started.length === 1 ? "" : "s"} started`];
      if (skipped) parts.push(`${skipped} skipped`);
      if (failed) parts.push(`${failed} failed`);
      setBatchMsg({
        text: parts.join(", "),
        tone: failed === 0 ? "ok" : "err",
      });
      // Merge with any in-flight batch instead of replacing (server may skip
      // already-running jobs, which must not clear a live progress bar).
      setBatchRun((prev) => {
        const ids = started.map((r) => r.id);
        if (ids.length === 0) return prev;
        return [...new Set([...(prev ?? []), ...ids])];
      });
    } catch (err: unknown) {
      setBatchMsg({
        text: err instanceof Error ? err.message : "Batch hermes update failed",
        tone: "err",
      });
    } finally {
      setBatchLoading(false);
      setTimeout(() => setBatchMsg(null), 6000);
    }
  }

  if (withoutWorkers.length === 0 || (hideOffline && withoutWorkers.every((spark) => !spark.online))) {
    const allWorkersHidden = hideWorkers && sparks.length > 0 && withoutWorkers.length === 0;
    const allOffline = hideOffline && withoutWorkers.length > 0;
    const title = allWorkersHidden
      ? "Worker nodes are hidden"
      : allOffline
        ? "All Sparks are offline"
        : "No Sparks registered";
    const detail = allWorkersHidden
      ? "Hide worker nodes is on in Settings. Turn it off to show Worker-role Sparks again."
      : allOffline
        ? "Auto-hide is enabled and no Sparks are currently online."
        : "Click the + tab to add a DGX Spark unit.";
    return (
      <div className="panel mx-auto mt-16 max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
          <ActivityIcon className="h-5 w-5" />
        </div>
        <h2 className="text-sm font-semibold text-text-strong">{title}</h2>
        <p className="mt-1 text-xs text-muted">{detail}</p>
      </div>
    );
  }

  const onlineCount = visibleSparks.filter((s) => s.online).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-overview-rhythm)" }}>
      {showFleetEnergy ? <FleetEnergyCard nodeCount={sparks.length} /> : null}
      {showFleetExceptions ? <FleetAlertStrip sparks={sparks} onSelect={onSelectSpark} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1
          className="font-normal leading-tight tracking-tight text-text-strong"
          style={{ fontSize: "var(--density-overview-title)" }}
        >
          {t("Overview")}</h1>
        <div className="flex flex-wrap items-end justify-end gap-3">
          {batchMsg && (
            <span className={`text-[11px] ${batchMsg.tone === "ok" ? "text-success" : "text-danger"}`}>
              {batchMsg.text}
            </span>
          )}
          {batchProg && (
            <div className="flex flex-col items-end gap-1">
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <RotateIcon className="h-3 w-3" />
                {t("Updating Hermes — ")}{batchProg.done}/{batchProg.total}
                {batchProg.failed > 0 && (
                  <span className="text-danger">({batchProg.failed} {t(" failed)")}</span>
                )}
                <button
                  type="button"
                  onClick={() => setBatchRun(null)}
                  aria-label={t("Dismiss update progress")}
                  title={t("Dismiss")}
                  className="rounded p-0.5 text-muted transition-colors hover:bg-surface-hover hover:text-text"
                >
                  <span className="text-xs leading-none">✕</span>
                </button>
              </span>
              <div className="h-1 w-36 overflow-hidden rounded-full bg-border">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                    batchProg.failed > 0 ? "bg-danger" : "bg-accent"
                  }`}
                  style={{
                    width: `${batchProg.total > 0 ? Math.round((batchProg.done / batchProg.total) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          {sparks.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {hermesMonitoredCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleUpdateAllHermes()}
                  disabled={batchLoading}
                  title={t("Run `hermes update` on every Spark with Hermes Agent enabled")}
                  className={`flex items-center gap-1 rounded-md border bg-surface-elevated px-2.5 py-1.5 text-[11px] transition-colors disabled:opacity-50 ${
                    hermesPendingUpdateCount > 0
                      ? "border-warning/40 text-warning hover:bg-warning/15"
                      : "border-border text-muted hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  <RotateIcon className="h-3 w-3" />
                  {t("Update Hermes")}{hermesPendingUpdateCount > 0 && (
                    <span
                      className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[9px] font-bold leading-none text-white"
                      title={t("{0} Spark{1} with a Hermes update available", hermesPendingUpdateCount, hermesPendingUpdateCount === 1 ? "" : "s")}
                    >
                      {hermesPendingUpdateCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
          <span className="online-chip">
            <span className="dot" />
            {onlineCount}/{visibleSparks.length} {t(" online")}</span>
          {hiddenWorkerCount > 0 && (
            <span className="text-[11px] text-muted">
              {hiddenWorkerCount} {t(" worker")}{hiddenWorkerCount === 1 ? "" : "s"} {t(" hidden")}</span>
          )}
        </div>
      </div>
      {showOverviewSearch ? (
      <div className="flex flex-wrap gap-2" role="search" aria-label={t("Filter fleet units")}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search up to 12 units")}
          aria-label={t("Search units by name")}
          className="min-h-11 min-w-52 flex-1 rounded border border-border bg-surface-elevated px-3 text-sm text-text"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          aria-label={t("Filter units by status")}
          className="min-h-11 rounded border border-border bg-surface-elevated px-3 text-sm text-text"
        >
          <option value="all">{t("All status")}</option>
          <option value="online">{t("Online")}</option>
          <option value="offline">{t("Offline")}</option>
          <option value="issues">{t("Issues")}</option>
        </select>
      </div>
      ) : null}
      {showLlmTokenTotals ? <FleetTokenTotals /> : null}
      <div className="overview-page grid sm:grid-cols-2 lg:grid-cols-3" style={{ gap: "var(--density-page-gap)" }}>
        {visibleSparks.length === 0 && (
          <p className="panel p-6 text-sm text-muted sm:col-span-2 lg:col-span-3">
            {t("No units match the current search and status filters.")}</p>
        )}
        {visibleSparks.map((spark) => (
          <SparkCard
            key={spark.id}
            spark={spark}
            temperatureUnit={temperatureUnit}
            onSelect={onSelectSpark}
          />
        ))}
        {visibleSparks.map((spark) => (
          <LlmStatsCard key={`llm-${spark.id}`} spark={spark} onSelect={onSelectSpark} />
        ))}
      </div>
    </div>
  );
}