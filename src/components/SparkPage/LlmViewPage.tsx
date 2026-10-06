/**
 * Fleet-level LLM page — its own top-bar tab, peer to the node pages.
 * Renders one section per Spark with LLM monitoring enabled; each section
 * holds one LlmPanel per configured port plus the add-port affordance.
 */
import { t, useI18n } from "../../i18n";
import { useCallback, useEffect, useState } from "react";
import type { SparkSnapshot } from "../../api/types";
import { isLlmMonitoringEnabled } from "../../api/sparkRole";
import { addLlmPort, removeLlmPort } from "../../api/client";
import { LlmPanel } from "./LlmPanel";

interface LlmFleetPageProps {
  sparks: SparkSnapshot[];
  /** Show "Copy image" in the benchmark dialogs (Settings, off by default). */
  benchShareImage?: boolean;
  onSelectSpark?: (id: string) => void;
}

export function LlmFleetPage({ sparks, benchShareImage = false, onSelectSpark }: LlmFleetPageProps) {
  useI18n();
  const llmSparks = sparks.filter(isLlmMonitoringEnabled);
  if (llmSparks.length === 0) {
    return (
      <div className="panel mx-auto mt-16 max-w-md p-8 text-center">
        <h2 className="text-sm font-semibold text-text-strong">{t("No LLM monitored nodes")}</h2>
        <p className="mt-1 text-xs text-muted">
          {t("Enable LLM monitoring in Edit Spark to see LLM stats.")}
        </p>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col"
      style={{ gap: "calc(var(--density-page-gap) * 1.5)", marginTop: "var(--density-page-gap)" }}
    >
      {llmSparks.map((spark) => (
        <SparkLlmSection
          key={spark.id}
          spark={spark}
          benchShareImage={benchShareImage}
          onSelectSpark={onSelectSpark}
        />
      ))}
    </div>
  );
}

function SparkLlmSection({
  spark,
  benchShareImage,
  onSelectSpark,
}: {
  spark: SparkSnapshot;
  benchShareImage: boolean;
  onSelectSpark?: (id: string) => void;
}) {
  useI18n();
  const { metrics } = spark;
  const [llmPorts, setLlmPorts] = useState<number[]>(spark.llmPorts ?? [spark.llmPort ?? 8888]);
  const [showAddPort, setShowAddPort] = useState(false);
  const [newPortDraft, setNewPortDraft] = useState("");

  useEffect(() => {
    if (spark.llmPorts) setLlmPorts(spark.llmPorts);
  }, [spark.llmPorts]);

  const handleAddPort = useCallback(async () => {
    const port = parseInt(newPortDraft, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return;
    if (llmPorts.includes(port)) {
      setNewPortDraft("");
      setShowAddPort(false);
      return;
    }
    try {
      const result = await addLlmPort(spark.id, port);
      setLlmPorts(result.llmPorts);
      setNewPortDraft("");
      setShowAddPort(false);
    } catch (err) {
      console.error("Failed to add LLM port:", err);
    }
  }, [spark.id, newPortDraft, llmPorts]);

  const handleRemovePort = useCallback(
    async (port: number) => {
      try {
        const result = await removeLlmPort(spark.id, port);
        setLlmPorts(result.llmPorts);
      } catch (err) {
        console.error("Failed to remove LLM port:", err);
      }
    },
    [spark.id]
  );

  return (
    <section className="flex flex-col" style={{ gap: "var(--density-page-gap)" }}>
      {/* Section header — node name jumps back to the node page */}
      <div className="flex items-center gap-2.5">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${spark.online ? "bg-success dot-glow-success" : "bg-danger"}`}
        />
        <h2 className="min-w-0 truncate text-base font-semibold text-text-strong">
          {onSelectSpark ? (
            <button
              type="button"
              onClick={() => onSelectSpark(spark.id)}
              className="text-left font-inherit text-inherit hover:underline"
            >
              {spark.name}
            </button>
          ) : (
            spark.name
          )}
        </h2>
      </div>
      <div
        className="grid grid-cols-1 md:grid-cols-2"
        style={{ gap: "var(--density-page-gap)" }}
      >
        {llmPorts.map((port, portIndex) => (
          <LlmPanel
            key={port}
            llm={metrics.llm?.[portIndex] ?? null}
            sparkId={spark.id}
            sparkName={spark.name}
            llmPort={port}
            llmPorts={llmPorts}
            hasApiKey={Boolean(spark.llmApiKeyPorts?.includes(port))}
            shareImage={benchShareImage}
            onRemovePort={portIndex > 0 ? handleRemovePort : undefined}
            className={llmPorts.length === 1 ? "md:col-span-2" : undefined}
          />
        ))}
        {showAddPort ? (
          <div className="md:col-span-2 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={65535}
                inputMode="numeric"
                placeholder={t("Port number")}
                value={newPortDraft}
                onChange={(e) => setNewPortDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAddPort();
                  }
                }}
                className="w-32 rounded-md border border-border bg-surface-elevated px-3 py-1.5 font-tabular text-sm text-text outline-none focus:border-accent"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void handleAddPort()}
                disabled={!newPortDraft.trim()}
                className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {t("Add")}</button>
              <button
                type="button"
                onClick={() => {
                  setShowAddPort(false);
                  setNewPortDraft("");
                }}
                className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-hover"
              >
                {t("Cancel")}</button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddPort(true)}
            className="md:col-span-2 rounded-lg border border-dashed border-border bg-transparent p-3 text-xs text-muted hover:border-accent hover:text-accent transition-colors"
          >
            {t("+ Add LLM port")}</button>
        )}
      </div>
    </section>
  );
}
