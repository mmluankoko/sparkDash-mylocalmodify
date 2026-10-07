/**
 * Fleet-level LLM service control page — its own top-bar tab, peer to the
 * node pages. One big card per configured unit: one row per LLM service with
 * rank dots, status badge, elapsed timers and Start/Stop actions.
 *
 * All commands live in the server-side allowlist (config/llm-services.json);
 * this page only names services. Start returns 202 and the load progress is
 * followed through status polling + a live docker-logs tail.
 */
import { t, useI18n } from "../../i18n";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Panel } from "../ui/Panel";
import {
  llmDisplayName,
  subscribeLlmModelNames,
  getLlmModelNamesVersion,
} from "../../api/llmModelNames";
import {
  fetchLlmCtl,
  fetchLlmCtlLogs,
  startLlmService,
  stopLlmService,
} from "../../api/client";
import type { LlmCtlService, LlmCtlUnit, LlmServiceState } from "../../api/types";

const STATUS_POLL_MS = 3000;
const LOG_POLL_MS = 2000;
const LOG_LINES = 24;

/** Buttons enabled per state. */
function canStart(status: LlmServiceState): boolean {
  return status === "stopped" || status === "failed" || status === "unknown";
}
function canStop(status: LlmServiceState): boolean {
  return status === "starting" || status === "loading" || status === "ready";
}

function StatusBadge({ status }: { status: LlmServiceState }) {
  useI18n();
  const cls =
    status === "ready"
      ? "border-success/40 text-success"
      : status === "loading" || status === "starting" || status === "stopping"
        ? "border-warning/40 text-warning"
        : status === "failed"
          ? "border-danger/40 text-danger"
          : "border-border text-muted";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status === "starting" || status === "stopping" ? (
        <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-current" aria-hidden />
      ) : null}
      {t(STATUS_LABELS[status] ?? status)}
    </span>
  );
}

const STATUS_LABELS: Record<LlmServiceState, string> = {
  stopped: "Stopped",
  starting: "Starting…",
  loading: "Loading model…",
  ready: "Running",
  stopping: "Stopping…",
  failed: "Failed",
  unknown: "Unknown",
};

/** mm:ss elapsed helper. */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Live ticking clock for elapsed displays (re-renders once per second). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

interface LogTailerProps {
  sparkId: string;
  serviceName: string;
  rank: number;
}

/** Poll docker-logs tail for a service rank; auto-polls while visible. */
function LogTailer({ sparkId, serviceName, rank }: LogTailerProps) {
  useI18n();
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetchLlmCtlLogs(sparkId, serviceName, rank, LOG_LINES);
        if (!alive) return;
        setError(res.error ?? null);
        setLines(res.lines);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), LOG_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [sparkId, serviceName, rank]);

  useEffect(() => {
    // Keep the latest log line in view while tailing.
    const pre = preRef.current;
    if (pre) pre.scrollTop = pre.scrollHeight;
  }, [lines]);

  return (
    <pre
      ref={preRef}
      className={`mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border bg-black/20 p-2 text-left font-mono text-[11px] leading-relaxed text-muted ${error ? "text-danger" : ""}`}
    >
      {error ? error : lines.length ? lines.join("\n") : t("No log output yet")}
    </pre>
  );
}

interface ServiceRowProps {
  unit: LlmCtlUnit;
  service: LlmCtlService;
  busy: boolean;
  onAction: (service: LlmCtlService, action: "start" | "stop") => void;
}

function ServiceRow({ unit, service, busy, onAction }: ServiceRowProps) {
  useI18n();
  const [showLogs, setShowLogs] = useState(false);
  const [logRank, setLogRank] = useState(0);
  const active = service.status === "starting" || service.status === "loading";
  const now = useNow(active || service.status === "ready");
  // Global display name (config/llm-model-names.json); falls back to the
  // service label, then the raw id. The raw id is always shown as secondary.
  useSyncExternalStore(subscribeLlmModelNames, getLlmModelNamesVersion);
  const resolved = service.modelId ? llmDisplayName(service.modelId) : "";
  const displayName =
    resolved && resolved !== service.modelId ? resolved : service.label || service.modelId || service.name;

  const slotTaken = unit.services.some(
    (s) => s.name !== service.name && ["starting", "loading", "ready", "stopping"].includes(s.status)
  );
  const otherBusy = slotTaken && !canStop(service.status);

  return (
    <div className="rounded-lg border border-border bg-surface-elevated/60 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Rank dots — one per cluster node (head first) */}
        <div className="flex shrink-0 items-center gap-1.5" title={unit.rankLabels.join(" / ")}>
          {unit.rankLabels.map((label, i) => {
            const rankState = service.ranks.find((r) => r.rank === i)?.state ?? null;
            const up = rankState === "running" || rankState === "restarting";
            return (
              <span
                key={label}
                className={`inline-block h-2 w-2 rounded-full ${up ? "bg-success" : rankState ? "bg-muted" : "bg-border"}`}
                title={`${label}: ${rankState ?? "—"}`}
              />
            );
          })}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text-strong">{displayName}</span>
            {service.engine ? (
              <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                {service.engine}
              </span>
            ) : null}
          </div>
          {service.modelId ? (
            <div className="truncate font-mono text-[10px] text-muted" title={service.modelId}>
              {service.modelId}
            </div>
          ) : null}
        </div>
        <StatusBadge status={service.status} />
        <span className="shrink-0 text-xs tabular-nums text-muted">
          {service.status === "loading" || service.status === "starting"
            ? t("for {0}", fmtElapsed(now - (service.startedAt ?? now)))
            : service.status === "ready" && service.readyAt
              ? t("up {0}", fmtElapsed(now - service.readyAt))
              : ""}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || !canStart(service.status) || slotTaken}
            title={slotTaken ? t("Another model holds the port — stop it first") : undefined}
            onClick={() => onAction(service, "start")}
          >
            {t("Start")}
          </button>
          <button
            type="button"
            className="rounded-md border border-danger/40 px-3 py-1.5 text-[11px] font-medium text-danger transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || !canStop(service.status)}
            onClick={() => onAction(service, "stop")}
          >
            {t("Stop")}
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-[11px] text-muted transition-colors hover:bg-surface-hover hover:text-text"
            aria-expanded={showLogs}
            onClick={() => setShowLogs((v) => !v)}
          >
            {t("Logs")}
          </button>
        </div>
      </div>

      {service.lastError ? (
        <p className="mt-1.5 text-xs text-danger">{service.lastError}</p>
      ) : service.slow ? (
        <p className="mt-1.5 text-xs text-warning">
          {t("Loading is taking unusually long ({0}+). Check the logs.", "15m")}
        </p>
      ) : null}

      {showLogs ? (
        <div>
          {unit.rankLabels.length > 1 ? (
            <div className="mt-2 flex items-center gap-1.5">
              {unit.rankLabels.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  className={`rounded border px-2 py-0.5 text-[10px] transition-colors ${
                    logRank === i
                      ? "border-accent/50 bg-accent-soft text-text-strong"
                      : "border-border text-muted hover:bg-surface-hover"
                  }`}
                  onClick={() => setLogRank(i)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <LogTailer sparkId={unit.sparkId} serviceName={service.name} rank={logRank} />
        </div>
      ) : null}
      {otherBusy ? (
        <p className="mt-1.5 text-[11px] text-muted">
          {t("Port {0} is occupied — only one model can run at a time.", String(unit.port))}
        </p>
      ) : null}
    </div>
  );
}

interface ConfirmState {
  service: LlmCtlService;
  action: "start" | "stop";
}

export function LlmControlPage() {
  useI18n();
  const [units, setUnits] = useState<LlmCtlUnit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConfirmState | null>(null);
  const unitsRef = useRef<LlmCtlUnit[]>([]);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetchLlmCtl();
        if (!alive) return;
        unitsRef.current = res.units;
        setUnits(res.units);
        setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), STATUS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const doAction = useCallback(async (sparkId: string, name: string, action: "start" | "stop") => {
    setBusyKey(`${sparkId}:${name}`);
    try {
      if (action === "start") await startLlmService(sparkId, name);
      else await stopLlmService(sparkId, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
      // Refresh immediately so state flips without waiting for the next tick.
      try {
        const res = await fetchLlmCtl();
        unitsRef.current = res.units;
        setUnits(res.units);
      } catch {
        /* next poll covers it */
      }
    }
  }, []);

  const handleAction = useCallback(
    (service: LlmCtlService, action: "start" | "stop") => {
      // Find owning unit from the latest snapshot.
      const unit = unitsRef.current.find((u) => u.services.some((s) => s.name === service.name));
      if (!unit) return;
      if (action === "start" && service.status === "failed") {
        // Restarting a failed service still deserves a confirm (GPU slot).
        setConfirming({ service, action });
        return;
      }
      if (action === "stop") {
        setConfirming({ service, action });
        return;
      }
      void doAction(unit.sparkId, service.name, action);
    },
    [doAction]
  );

  if (units.length === 0) {
    return (
      <div className="panel mx-auto mt-16 max-w-md p-8 text-center">
        <h2 className="text-sm font-semibold text-text-strong">{t("No LLM services configured")}</h2>
        <p className="mt-1 text-xs text-muted">
          {t("Add services to config/llm-services.json to control them from here.")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col"
      style={{ gap: "calc(var(--density-page-gap) * 1.5)", marginTop: "var(--density-page-gap)" }}
    >
      {error ? (
        <div className="rounded-md border border-danger/30 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
      {units.map((unit) => (
        <Panel
          key={unit.sparkId}
          title="LLM Control"
          accent
          actions={
            <span className="text-xs text-muted">
              {t("port {0} · one model at a time", String(unit.port))}
            </span>
          }
        >
          <div className="flex flex-col gap-2.5">
            {unit.services.map((svc) => (
              <ServiceRow
                key={`${unit.sparkId}:${svc.name}`}
                unit={unit}
                service={svc}
                busy={busyKey === `${unit.sparkId}:${svc.name}`}
                onAction={handleAction}
              />
            ))}
          </div>
        </Panel>
      ))}

      {confirming ? <ConfirmActionDialog confirming={confirming} unit={units.find((u) => u.services.some((s) => s.name === confirming.service.name)) ?? null} onClose={() => setConfirming(null)} onConfirm={doAction} /> : null}
    </div>
  );
}

function ConfirmActionDialog({
  confirming,
  unit,
  onClose,
  onConfirm,
}: {
  confirming: ConfirmState;
  unit: LlmCtlUnit | null;
  onClose: () => void;
  onConfirm: (sparkId: string, name: string, action: "start" | "stop") => Promise<void>;
}) {
  useI18n();
  const [submitting, setSubmitting] = useState(false);
  const { service, action } = confirming;

  const run = async () => {
    if (!unit) return;
    setSubmitting(true);
    try {
      await onConfirm(unit.sparkId, service.name, action);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="panel w-full max-w-sm p-5">
        <h3 className="text-sm font-semibold text-text-strong">
          {action === "stop" ? t("Stop {0}?", service.label) : t("Restart {0}?", service.label)}
        </h3>
        <p className="mt-2 text-xs text-muted">
          {action === "stop"
            ? t("The model API on port {0} will stop serving. Existing requests finish or drop.", String(unit?.port ?? ""))
            : t("Starting takes 3–10 minutes. The GPU slot must be free.")}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-[11px] text-muted transition-colors hover:bg-surface-hover hover:text-text"
            disabled={submitting}
            onClick={onClose}
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              action === "stop" ? "bg-danger text-white hover:opacity-90" : "bg-accent text-black hover:bg-accent-hover"
            }`}
            disabled={submitting}
            onClick={() => void run()}
          >
            {submitting ? t("Working…") : action === "stop" ? t("Stop") : t("Start")}
          </button>
        </div>
      </div>
    </div>
  );
}
