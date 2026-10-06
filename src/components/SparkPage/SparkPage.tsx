import { t, useI18n } from "../../i18n";
import { useState, useEffect, useCallback, type CSSProperties } from "react";
import type { SparkSnapshot } from "../../api/types";
import { updateSpark, refreshSparkMetric } from "../../api/client";
import { SparkHeader } from "./SparkHeader";
import { SparkActions } from "./SparkActions";
import { GpuPanel } from "./GpuPanel";
import { CpuPanel } from "./CpuPanel";
import { RamPanel } from "./RamPanel";
import { StoragePanel } from "./StoragePanel";
import { NetworkPanel } from "./NetworkPanel";
import { TailscalePanel } from "./TailscalePanel";
import { ComfyPanel } from "./ComfyPanel";
import { ChevronDownIcon } from "../ui/icons";

interface SparkPageProps {
  spark: SparkSnapshot;
  temperatureUnit: "celsius" | "fahrenheit";
  onEdit?: () => void;
}

const SECTION_OPEN_KEYS = {
  resources: "sparkdash.ui.section.resources",
  services: "sparkdash.ui.section.services",
} as const;

function readSectionOpen(key: string, fallback = true): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "0" || raw === "false") return false;
    if (raw === "1" || raw === "true") return true;
  } catch {
    /* private mode / blocked storage */
  }
  return fallback;
}

function writeSectionOpen(key: string, open: boolean) {
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Clickable section title with chevron; collapses/expands the panels below. */
function SectionHeading({
  title,
  open,
  onToggle,
  style,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  style?: CSSProperties;
}) {
  useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="md:col-span-2 flex w-full items-center gap-2 text-left font-normal leading-tight tracking-tight text-text-strong transition-colors hover:text-accent"
      style={{
        fontSize: "var(--density-overview-title)",
        ...style,
      }}
    >
      <ChevronDownIcon
        className={`h-5 w-5 shrink-0 text-muted transition-transform duration-150 ${
          open ? "" : "-rotate-90"
        }`}
      />
      <span>{title}</span>
    </button>
  );
}

export function SparkPage({
  spark,
  temperatureUnit,
  onEdit,
}: SparkPageProps) {
  useI18n();
  const { metrics } = spark;
  const [disabledDevices, setDisabledDevices] = useState<string[]>(spark.disabledDevices || []);
  const [disabledInterfaces, setDisabledInterfaces] = useState<string[]>(
    spark.disabledInterfaces || []
  );
  const [storagePollDisabled, setStoragePollDisabled] = useState<boolean>(
    spark.storagePollDisabled ?? false
  );
  const [resourcesOpen, setResourcesOpen] = useState(() =>
    readSectionOpen(SECTION_OPEN_KEYS.resources, true)
  );
  const [servicesOpen, setServicesOpen] = useState(() =>
    readSectionOpen(SECTION_OPEN_KEYS.services, true)
  );

  const toggleResources = useCallback(() => {
    setResourcesOpen((prev) => {
      const next = !prev;
      writeSectionOpen(SECTION_OPEN_KEYS.resources, next);
      return next;
    });
  }, []);

  const toggleServices = useCallback(() => {
    setServicesOpen((prev) => {
      const next = !prev;
      writeSectionOpen(SECTION_OPEN_KEYS.services, next);
      return next;
    });
  }, []);

  // Sync when spark data changes (WS push)
  useEffect(() => {
    setDisabledDevices(spark.disabledDevices || []);
  }, [spark.disabledDevices]);

  useEffect(() => {
    setDisabledInterfaces(spark.disabledInterfaces || []);
  }, [spark.disabledInterfaces]);

  useEffect(() => {
    setStoragePollDisabled(spark.storagePollDisabled ?? false);
  }, [spark.storagePollDisabled]);

  const handleStoragePollModeChange = useCallback(
    async (disabled: boolean) => {
      setStoragePollDisabled(disabled);
      try {
        await updateSpark(spark.id, { storagePollDisabled: disabled });
        // When disabling auto-refresh, do one manual refresh immediately
        if (disabled) {
          refreshSparkMetric(spark.id, "storage").catch((err) =>
            console.error("Failed to refresh storage after disabling auto-refresh:", err)
          );
        }
      } catch (err) {
        console.error("Failed to update storage poll mode:", err);
        setStoragePollDisabled(!disabled); // revert
      }
    },
    [spark.id]
  );

  const comfyOn = Boolean(spark.comfyMonitoring);
  const tailscaleOn = Boolean(spark.tailscaleMonitoring);
  const showServices = comfyOn;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--density-page-gap)" }}>
      <SparkHeader spark={spark} onEdit={onEdit} />
      {/* Mobile-only action row (Update Hermes / Shutdown·Wake / Edit) — desktop keeps them in the header. */}
      <SparkActions
        spark={spark}
        onEdit={onEdit}
        className="flex flex-wrap items-center justify-end gap-2 px-1 py-1 sm:hidden"
      />
      <div className="spark-page grid grid-cols-1 md:grid-cols-2" style={{ gap: "var(--density-page-gap)" }}>
        <SectionHeading
          title={t("Resources")}
          open={resourcesOpen}
          onToggle={toggleResources}
          style={{ marginTop: "var(--density-page-gap)" }}
        />
        {resourcesOpen && (
          /* Two independent columns so panels take natural heights (no row-stretch
             dead space). Left: GPU + CPU stacked (CPU sits directly under GPU).
             Right: the rest, stacked independently. */
          <div
            className="md:col-span-2 grid grid-cols-1 md:grid-cols-2"
            style={{ gap: "var(--density-page-gap)" }}
          >
            <div className="flex flex-col" style={{ gap: "var(--density-page-gap)" }}>
              <GpuPanel
                gpu={metrics.gpu}
                sparkId={spark.id}
                temperatureUnit={temperatureUnit}
              />
              {/* grow: fill the gap so the left column's bottom aligns with the right */}
              <CpuPanel
                cpu={metrics.cpu}
                sparkId={spark.id}
                temperatureUnit={temperatureUnit}
                className="grow"
              />
            </div>
            <div className="flex flex-col" style={{ gap: "var(--density-page-gap)" }}>
              {spark.kind === "host" && <RamPanel ram={metrics.ram} sparkId={spark.id} />}
              <StoragePanel
                storage={metrics.storage}
                sparkId={spark.id}
                disabledDevices={disabledDevices}
                onDisabledChange={setDisabledDevices}
                storagePollDisabled={storagePollDisabled}
                onStoragePollModeChange={handleStoragePollModeChange}
              />
              {/* grow: the right column's bottom panel fills the gap (Network, or
                  Tailnet when it's the last one) so both columns end at the same height */}
              <NetworkPanel
                network={metrics.network}
                sparkId={spark.id}
                disabledInterfaces={disabledInterfaces}
                onDisabledChange={setDisabledInterfaces}
                className={tailscaleOn ? undefined : "grow"}
              />
              {tailscaleOn && (
                <TailscalePanel tailscale={metrics.tailscale ?? null} className="grow" />
              )}
            </div>
          </div>
        )}
        {/* Services layout: ComfyUI only — LLM panels moved to the LLM page. */}
        {showServices && (
          <SectionHeading
            title={t("Services")}
            open={servicesOpen}
            onToggle={toggleServices}
            style={{ marginTop: "var(--density-page-gap)" }}
          />
        )}
        {showServices && servicesOpen && (
          <ComfyPanel
            comfy={metrics.comfy ?? null}
            comfyPort={spark.comfyPort ?? 8188}
            sparkId={spark.id}
            lanIp={spark.lanIp}
            className="md:col-span-2"
          />
        )}
      </div>
    </div>
  );
}