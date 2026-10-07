import { t, useI18n } from "./i18n";
import { useState, useCallback, useEffect, useMemo } from "react";
import { useSnapshot } from "./hooks/useSnapshot";
import { useAppRoute, useRoute } from "./hooks/useRoute";
import { fetchSparks, fetchSettings, fetchHealth, fetchLlmCtl } from "./api/client";
import { loadLlmModelNames } from "./api/llmModelNames";
import { SparkTabs } from "./components/SparkTabs";
import { AddSparkDialog } from "./components/AddSparkDialog";
import { EditSparkDialog } from "./components/EditSparkDialog";
import { SparkPage } from "./components/SparkPage/SparkPage";
import { LlmFleetPage } from "./components/SparkPage/LlmViewPage";
import { ComfyFleetPage } from "./components/SparkPage/ComfyFleetPage";
import { LlmControlPage } from "./components/SparkPage/LlmControlPage";
import { HermesUpdateDialog } from "./components/SparkPage/HermesUpdateDialog";
import { OverviewPage } from "./components/OverviewPage/OverviewPage";
import { ShowcasePage } from "./components/ShowcasePage/ShowcasePage";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { initializeLanguage, setLanguage } from "./i18n";
import { OpenAccessChip } from "./components/OpenAccessChip";
import { SettingsDialog } from "./components/SettingsDialog";
import { AccessTokenPrompt } from "./components/AccessTokenDialog";
import { onTokenChange } from "./api/authToken";
import { GearIcon, BoltIcon } from "./components/ui/icons";
import { ConnectionBanner } from "./components/ui/ConnectionBanner";
import { ErrorBanner } from "./components/ui/ErrorBanner";
import { OVERVIEW_ID, LLM_ID, COMFY_ID, LLMCTL_ID } from "./constants";
import type { AuthMode, Settings, SparkSnapshot } from "./api/types";
import { isWorkerSpark } from "./api/sparkRole";

function placeholderSnapshot(
  id: string,
  name: string,
  disabledDevices: string[] = [],
  disabledInterfaces: string[] = [],
  llmPorts: number[] = [8888],
  roleFields?: {
    role?: SparkSnapshot["role"];
    workerNode?: boolean;
    workerLabel?: string | null;
    workerHeadId?: string | null;
    llmMonitoring?: boolean;
    comfyMonitoring?: boolean;
    comfyPort?: number;
    tailscaleMonitoring?: boolean;
    kind?: "spark" | "host";
  }
): SparkSnapshot {
  const role =
    roleFields?.role === "head" ||
    roleFields?.role === "worker" ||
    roleFields?.role === "standalone"
      ? roleFields.role
      : roleFields?.workerNode
        ? "worker"
        : "standalone";
  const workerNode = role === "worker";
  return {
    id,
    name,
    kind: roleFields?.kind ?? "spark",
    online: false,
    uptime: null,
    disabledDevices,
    disabledInterfaces,
    llmPort: llmPorts[0] ?? 8888,
    llmPorts,
    workerNode,
    role,
    workerLabel: workerNode ? roleFields?.workerLabel ?? null : null,
    workerHeadId: workerNode ? roleFields?.workerHeadId ?? null : null,
    llmMonitoring:
      role === "worker"
        ? false
        : role === "head"
          ? true
          : roleFields?.llmMonitoring !== false,
    comfyMonitoring: Boolean(roleFields?.comfyMonitoring),
    comfyPort: roleFields?.comfyPort ?? 8188,
    tailscaleMonitoring: Boolean(roleFields?.tailscaleMonitoring),
    hermes: {
      monitoring: false,
      installed: null,
      version: null,
      updateAvailable: null,
      behindCommits: null,
      checkedAt: null,
      status: "idle",
      startedAt: null,
      finishedAt: null,
      error: null,
    },
    hardware: {
      device: "NVIDIA DGX Spark",
      cpuModel: "…",
      cpuCores: 0,
      totalMemoryGB: 0,
      gpuChip: "…",
      cudaDriver: null,
      storageModel: null,
    },
    metrics: {
      gpu: null,
      cpu: null,
      ram: null,
      storage: [],
      network: null,
      unifiedMemory: null,
      llm: [],
      comfy: null,
      tailscale: null,
    },
  };
}

function DashboardApp() {
  useI18n();
  const {
    sparks,
    activeId,
    setActiveId,
    activeSpark,
    connected,
    lastValidSnapshotAt,
    snapshotError,
    refreshInterval,
  } = useSnapshot();
  const [telemetryNow, setTelemetryNow] = useState(Date.now());
  const navigate = useRoute(setActiveId);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** LLM service control is available when config/llm-services.json has units. */
  const [llmCtlAvailable, setLlmCtlAvailable] = useState(false);
  /** Used when WS is down so add/delete still updates the tab bar */
  const [fallbackSparks, setFallbackSparks] = useState<SparkSnapshot[]>([]);
  const staleAfterMs = Math.max(10_000, 3 * (refreshInterval ?? 2_000));
  const telemetryStale =
    lastValidSnapshotAt != null && telemetryNow - lastValidSnapshotAt > staleAfterMs;

  useEffect(() => {
    if (lastValidSnapshotAt == null) return;
    setTelemetryNow(Date.now());
    const timer = window.setInterval(() => setTelemetryNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [lastValidSnapshotAt]);

  // Prefer live WS data; fall back to API-fetched list when empty
  const liveSparks = sparks.length > 0 ? sparks : fallbackSparks;
  const displaySparks = liveSparks;

  const isOverview = activeId === OVERVIEW_ID;
  const isLlmView = activeId === LLM_ID;
  const isComfyView = activeId === COMFY_ID;
  const isLlmCtlView = activeId === LLMCTL_ID;
  const hideWorkers = settings?.hideWorkers ?? false;
  const hiddenWorkerIds = useMemo(() => {
    if (!hideWorkers) return new Set<string>();
    return new Set(
      displaySparks
        .filter((s) => isWorkerSpark(s) && s.id !== activeId)
        .map((s) => s.id)
    );
  }, [displaySparks, hideWorkers, activeId]);
  const tabSparks = useMemo(
    () => (hideWorkers ? displaySparks.filter((s) => !hiddenWorkerIds.has(s.id)) : displaySparks),
    [displaySparks, hideWorkers, hiddenWorkerIds]
  );
  const displayActive =
    isOverview || isLlmView || isComfyView || isLlmCtlView
      ? null
      : displaySparks.find((s) => s.id === activeId) || displaySparks[0] || activeSpark || null;

  useEffect(() => {
    if (sparks.length > 0) setFallbackSparks([]);
  }, [sparks]);

  // Fetch global settings on mount, and again when a new access token is
  // saved (the first load may have been refused for the missing token).
  useEffect(() => {
    const load = (afterTokenChange: boolean) =>
      fetchSettings()
        .then((s) => {
          setSettings(s);
          if (afterTokenChange) setActionError(null);
        })
        .catch((err) =>
          setActionError(
            `Could not load settings: ${err instanceof Error ? err.message : String(err)}. Reload to retry.`
          )
        );
    void load(false);
    return onTokenChange((token) => {
      if (token) void load(true);
    });
  }, []);

  // Auth posture once on load — drives the "Open access" header warning.
  useEffect(() => {
    fetchHealth()
      .then((h) => setAuthMode(h.authMode))
      .catch(() => setAuthMode(null));
  }, []);

  // LLM service control availability (tab visibility) — cheap, once on load.
  useEffect(() => {
    fetchLlmCtl()
      .then((res) => setLlmCtlAvailable(res.units.length > 0))
      .catch(() => setLlmCtlAvailable(false));
    void loadLlmModelNames();
  }, []);

  const handleSettingsSaved = useCallback((s: Settings) => {
    setSettings(s);
    if (s.defaultLanguage !== settings?.defaultLanguage) setLanguage(s.defaultLanguage);
  }, [settings?.defaultLanguage]);

  // Apply layout density (comfortable/compact) from persisted settings.
  useEffect(() => {
    if (settings?.density) {
      document.documentElement.setAttribute("data-density", settings.density);
    }
  }, [settings?.density]);

  const refreshFromApi = useCallback(async () => {
    try {
      const { sparks: configs } = await fetchSparks();
      setFallbackSparks(
        configs.map((c) => {
          const existing = sparks.find((s) => s.id === c.id);
          if (existing) {
            // Keep live metrics, but never let a stale WS snapshot override
            // role fields that were just saved via the API.
            return {
              ...existing,
              name: c.name,
              role: c.role ?? existing.role,
              workerNode: c.workerNode ?? existing.workerNode,
              workerLabel: c.workerLabel ?? existing.workerLabel,
              workerHeadId: c.workerHeadId ?? existing.workerHeadId,
              llmMonitoring: c.llmMonitoring ?? existing.llmMonitoring,
              comfyMonitoring: c.comfyMonitoring ?? existing.comfyMonitoring,
              comfyPort: c.comfyPort ?? existing.comfyPort,
              tailscaleMonitoring: c.tailscaleMonitoring ?? existing.tailscaleMonitoring,
              disabledDevices: c.disabledDevices || existing.disabledDevices,
              disabledInterfaces: c.disabledInterfaces || existing.disabledInterfaces,
              llmPorts: c.llmPorts ?? existing.llmPorts,
              llmPort: c.llmPorts?.[0] ?? c.llmPort ?? existing.llmPort,
              kind: c.kind ?? existing.kind,
            };
          }
          return placeholderSnapshot(
            c.id,
            c.name,
            c.disabledDevices || [],
            c.disabledInterfaces || [],
            c.llmPorts ?? (c.llmPort ? [c.llmPort] : [8888]),
            {
              role: c.role,
              workerNode: c.workerNode,
              workerLabel: c.workerLabel,
              workerHeadId: c.workerHeadId,
              llmMonitoring: c.llmMonitoring,
              comfyMonitoring: c.comfyMonitoring,
              comfyPort: c.comfyPort,
              tailscaleMonitoring: c.tailscaleMonitoring,
              kind: c.kind,
            }
          );
        })
      );
      if (
        configs.length &&
        activeId !== OVERVIEW_ID &&
        activeId !== LLM_ID &&
        activeId !== COMFY_ID &&
        activeId !== LLMCTL_ID &&
        !configs.some((c) => c.id === activeId)
      ) {
        setActiveId(configs[0].id);
      }
      if (configs.length === 0 && activeId !== OVERVIEW_ID && activeId !== LLM_ID && activeId !== COMFY_ID && activeId !== LLMCTL_ID) setActiveId(null);
    } catch (err) {
      console.error("Failed to refresh sparks:", err);
      setActionError(
        `Could not refresh Sparks: ${err instanceof Error ? err.message : String(err)}. Previous data remains visible.`
      );
    }
  }, [sparks, activeId, setActiveId]);

  return (
    <div className="min-h-screen p-0 text-text sm:p-8">
      <div className="dashboard-shell">
        <header className="flex flex-wrap items-center gap-3" style={{ marginBottom: "var(--density-header-gap)" }}>
          <button
            type="button"
            onClick={() => navigate(OVERVIEW_ID)}
            className="logo-pill"
          >
            <BoltIcon className="h-3.5 w-3.5 text-accent" />
            <span>
              spark<span className="logo-pill-dash">Dash</span>
            </span>
          </button>
          <SparkTabs
            sparks={tabSparks}
            activeId={displayActive?.id ?? activeId}
            onSelect={navigate}
            onAdd={() => setShowAdd(true)}
            onEdit={(id) => setEditId(id)}
            showLlmCtl={llmCtlAvailable}
          />
          <div className="ml-auto flex items-center gap-2.5">
            <LanguageSwitch />
            <OpenAccessChip authMode={authMode} />
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="icon-circle"
              title={t("Settings")}
              aria-label={t("Settings")}
            >
              <GearIcon className="h-4 w-4" />
            </button>
            <ThemeSwitch />
          </div>
        </header>
        <ConnectionBanner
          connected={connected}
          lastValidSnapshotAt={lastValidSnapshotAt}
          snapshotError={snapshotError}
          now={telemetryNow}
          stale={telemetryStale}
        />
        <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
        <main className={telemetryStale || !connected ? "telemetry-stale" : undefined}>
          {isOverview ? (
            <OverviewPage
              sparks={displaySparks}
              hideOffline={settings?.autoHideOffline ?? false}
              hideWorkers={hideWorkers}
              showFleetEnergy={settings?.showFleetEnergy ?? false}
              showFleetExceptions={settings?.showFleetExceptions ?? false}
              showOverviewSearch={settings?.showOverviewSearch ?? false}
              showLlmTokenTotals={settings?.showLlmTokenTotals ?? false}
              temperatureUnit={settings?.temperatureUnit ?? "celsius"}
              onSelectSpark={navigate}
            />
          ) : isLlmView ? (
            <LlmFleetPage
              sparks={displaySparks}
              benchShareImage={settings?.benchShareImage ?? false}
              onSelectSpark={navigate}
            />
          ) : isComfyView ? (
            <ComfyFleetPage
              sparks={displaySparks}
              onSelectSpark={navigate}
            />
          ) : isLlmCtlView ? (
            <LlmControlPage />
          ) : displayActive ? (
            <SparkPage
              spark={displayActive}
              fleet={displaySparks}
              temperatureUnit={settings?.temperatureUnit ?? "celsius"}
              showVramBreakdown={settings?.showVramBreakdown ?? true}
              onEdit={() => setEditId(displayActive.id)}
            />
          ) : (
            <div className="panel mx-auto mt-16 max-w-md p-8 text-center">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
                <span className="text-lg leading-none">+</span>
              </div>
              <h2 className="text-sm font-semibold text-text-strong">{t("No Spark registered")}</h2>
              <p className="mt-1 text-xs text-muted">
                {t("Click the ")}<span className="rounded border border-border bg-surface-elevated px-1 py-0.5 text-text">+</span>
                {t(" tab to add a DGX Spark unit.")}</p>
            </div>
          )}
        </main>
      </div>
      <HermesUpdateDialog />
      <AddSparkDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={() => {
          void refreshFromApi();
        }}
        defaultLlmPort={settings?.defaultLlmPort ?? 8888}
      />
      <EditSparkDialog
        open={editId != null}
        sparkId={editId}
        onClose={() => setEditId(null)}
        onSaved={() => {
          void refreshFromApi();
        }}
        onDeleted={(id) => {
          if (activeId === id) {
            const next = displaySparks.find((s) => s.id !== id);
            navigate(next?.id ?? OVERVIEW_ID);
          }
          void refreshFromApi();
        }}
      />
      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={handleSettingsSaved}
      />
    </div>
  );
}

function App() {
  useI18n();
  const route = useAppRoute();
  const [languageReady, setLanguageReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((settings) => {
        if (!cancelled) initializeLanguage(settings.defaultLanguage);
      })
      .catch(() => {
        if (!cancelled) initializeLanguage("zh-CN");
      })
      .finally(() => { if (!cancelled) setLanguageReady(true); });
    return () => { cancelled = true; };
  }, []);
  if (!languageReady) return <div className="p-8 text-muted">加载中 / Loading…</div>;
  return (
    <>
      {route.mode === "showcase" && route.showcaseSparkId ? (
        <ShowcasePage sparkId={route.showcaseSparkId} />
      ) : (
        <DashboardApp />
      )}
      <AccessTokenPrompt />
    </>
  );
}

export default App;
