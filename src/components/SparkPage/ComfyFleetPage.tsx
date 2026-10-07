/**
 * Fleet-level ComfyUI page — its own top-bar tab, peer to the node pages and
 * the LLM tab. Renders one ComfyPanel per Spark with ComfyUI monitoring on.
 */
import { t, useI18n } from "../../i18n";
import type { SparkSnapshot } from "../../api/types";
import { ComfyPanel } from "./ComfyPanel";

interface ComfyFleetPageProps {
  sparks: SparkSnapshot[];
  onSelectSpark?: (id: string) => void;
}

export function ComfyFleetPage({ sparks, onSelectSpark }: ComfyFleetPageProps) {
  useI18n();
  const comfySparks = sparks.filter((s) => Boolean(s.comfyMonitoring));
  if (comfySparks.length === 0) {
    return (
      <div className="panel mx-auto mt-16 max-w-md p-8 text-center">
        <h2 className="text-sm font-semibold text-text-strong">
          {t("No nodes monitor ComfyUI")}
        </h2>
        <p className="mt-1 text-xs text-muted">
          {t("Enable ComfyUI monitoring in Edit Spark to see its stats.")}
        </p>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col"
      style={{ gap: "calc(var(--density-page-gap) * 1.5)", marginTop: "var(--density-page-gap)" }}
    >
      {comfySparks.map((spark) => (
        <section
          key={spark.id}
          className="flex flex-col"
          style={{ gap: "var(--density-page-gap)" }}
        >
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
          <ComfyPanel
            comfy={spark.metrics?.comfy ?? null}
            comfyPort={spark.comfyPort ?? 8188}
            sparkId={spark.id}
            lanIp={spark.lanIp}
          />
        </section>
      ))}
    </div>
  );
}
