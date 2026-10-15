import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from "react";
import type { SparkSnapshot } from "../../api/types";
import { updateSpark, refreshSparkMetric } from "../../api/client";
import { SparkHeader } from "./SparkHeader";
import { HealthList } from "../ui/HealthFindings";
import { SparkActions } from "./SparkActions";
import { GpuPanel } from "./GpuPanel";
import { CpuPanel } from "./CpuPanel";
import { RamPanel } from "./RamPanel";
import { StoragePanel } from "./StoragePanel";
import { NetworkPanel } from "./NetworkPanel";
import { TailscalePanel } from "./TailscalePanel";
import { RocePanel } from "./RocePanel";
import { UnifiedMemoryPanel } from "./UnifiedMemoryPanel";
import "../../styles/spark.css";
import { vramContextFor } from "../../shared/vramBreakdown";

interface SparkPageProps {
  spark: SparkSnapshot;
  /** Every unit's snapshot — lets a worker find its head's LLM endpoint. */
  fleet?: SparkSnapshot[];
  temperatureUnit: "celsius" | "fahrenheit";
  /** Show "Copy image" in the benchmark dialogs (Settings, off by default). */
  benchShareImage?: boolean;
  /** GPU panel VRAM bar split by engine / system / free (Settings, on by default). */
  showVramBreakdown?: boolean;
  onEdit?: () => void;
}

/** Panel wrapper carrying its single-column (mobile) order as a CSS variable. */function Item({ order, children }: { order: number; children: ReactNode }) {
  return (
    <div className="sp-item" style={{ ["--o" as string]: order } as CSSProperties}>
      {children}
    </div>
  );
}

export function SparkPage({
  spark,
  fleet,
  temperatureUnit,
  showVramBreakdown = true,
  onEdit,
}: SparkPageProps) {
  const { metrics } = spark;
  const [disabledDevices, setDisabledDevices] = useState<string[]>(spark.disabledDevices || []);
  const [disabledInterfaces, setDisabledInterfaces] = useState<string[]>(
    spark.disabledInterfaces || []
  );
  const [storagePollDisabled, setStoragePollDisabled] = useState<boolean>(
    spark.storagePollDisabled ?? false
  );
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

  // Services (LLM / ComfyUI / model launchers) live on the fleet pages, not on the
  // Spark detail page — it only shows hardware and I/O panels.
  const tailscaleOn = Boolean(spark.tailscaleMonitoring);
  const unified = metrics.unifiedMemory;
  const showUnified = spark.kind !== "host" && unified != null && unified.total > 0;

  return (
    <div className="sp">
      <SparkHeader spark={spark} onEdit={onEdit} />
      {/* Mobile-only action row (Update Hermes / Edit / Power) — desktop keeps them in the header. */}
      <SparkActions spark={spark} onEdit={onEdit} className="sp-mobile-actions flex sm:hidden" />
      {spark.online ? <HealthList findings={spark.health} /> : null}

      {(
        /* Two independent columns (xl+): hardware on the left, services + I/O on the
           right. Below xl everything stacks in the Item order (GPU, memory, LLM first). */
        <div className="sp-cols">
          <div className="sp-col">
            <Item order={1}>
              <GpuPanel
                gpu={metrics.gpu}
                vramContext={showVramBreakdown ? vramContextFor(spark, fleet) : null}
                sparkId={spark.id}
                temperatureUnit={temperatureUnit}
                chip={spark.hardware.gpuChip}
                hideMemory={showUnified}
              />
            </Item>
            {/* Unified memory (or RAM on a dedicated host) and CPU sit side by side (they stack when the column is narrow). */}
            <Item order={2}>
              <div className="sp-pair">
                {showUnified && <UnifiedMemoryPanel um={unified} gpu={metrics.gpu} llm={metrics.llm} />}
                <CpuPanel
                  cpu={metrics.cpu}
                  hardware={spark.hardware}
                  sparkId={spark.id}
                  temperatureUnit={temperatureUnit}
                />
                {/* Dedicated hosts have system RAM instead of a unified pool: CPU and RAM side by side. */}
                {spark.kind === "host" && <RamPanel ram={metrics.ram} sparkId={spark.id} />}
              </div>
            </Item>
          </div>
          <div className="sp-col">
            <Item order={7}>
              <StoragePanel
                storage={metrics.storage}
                sparkId={spark.id}
                disabledDevices={disabledDevices}
                onDisabledChange={setDisabledDevices}
                storagePollDisabled={storagePollDisabled}
                onStoragePollModeChange={handleStoragePollModeChange}
              />
            </Item>
            <Item order={8}>
              <NetworkPanel
                network={metrics.network}
                sparkId={spark.id}
                disabledInterfaces={disabledInterfaces}
                onDisabledChange={setDisabledInterfaces}
              />
            </Item>
            {metrics.roce && metrics.roce.devices.length > 0 && (
              <Item order={8}>
                <RocePanel roce={metrics.roce} />
              </Item>
            )}
            {tailscaleOn && (
              <Item order={9}>
                <TailscalePanel tailscale={metrics.tailscale ?? null} />
              </Item>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
