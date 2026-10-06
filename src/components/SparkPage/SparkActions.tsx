import { t, useI18n } from "../../i18n";
import type { SparkSnapshot } from "../../api/types";
import { openHermesUpdateDialog } from "../../hooks/useHermesUpdateDialog";
import { EditIcon, RotateIcon } from "../ui/icons";

interface SparkActionsProps {
  spark: SparkSnapshot;
  onEdit?: () => void;
  /** Classes for the button-cluster wrapper (controls responsive visibility). */
  className?: string;
}

/**
 * Update Hermes / Edit action cluster. Power actions (Shutdown / Wake) were
 * removed by product decision. Rendered twice: inline in the SparkHeader
 * (desktop) and as a standalone row just above "Resources" on mobile.
 */
export function SparkActions({ spark, onEdit, className }: SparkActionsProps) {
  useI18n();
  const hermes = spark.hermes;
  const hermesRunning = hermes?.status === "running";

  function handleHermesUpdate() {
    openHermesUpdateDialog({
      sparkId: spark.id,
      sparkName: spark.name,
      currentVersion: hermes?.version ?? null,
    });
  }

  return (
    <div className={className}>
      {hermesRunning && (
        <span
          className="flex items-center gap-1.5 text-[11px] text-warning"
          title={t("Running `hermes update` on this machine via SSH — this can take a few minutes.")}
        >
          <RotateIcon className="h-3 w-3" />
          {t("Hermes updating…")}</span>
      )}
      {!hermesRunning && hermes?.monitoring && hermes.status === "error" && (
        <span
          className="max-w-[16rem] truncate text-[11px] text-danger"
          title={hermes.error || t("Hermes update failed")}
        >
          {t("Hermes update failed")}</span>
      )}
      {!hermesRunning && hermes?.monitoring && hermes.installed !== false && (
        <button
          type="button"
          onClick={() => void handleHermesUpdate()}
          title={
            hermes.updateAvailable === true
              ? t("Run \"hermes update\" on this machine via SSH{0}", hermes.behindCommits ? ` (${hermes.behindCommits} commits behind)` : "")
              : t("Open Hermes Agent update status and run updates on this machine via SSH")
          }
          className={`flex items-center gap-1.5 rounded-md border bg-surface-elevated px-3 py-1.5 text-[11px] transition-colors ${
            hermes.updateAvailable === true
              ? "border-warning/40 text-warning hover:bg-warning/15"
              : "border-border text-muted hover:bg-surface-hover hover:text-text"
          }`}
        >
          <RotateIcon className="h-3 w-3" />
          {t("Update Hermes")}{hermes.updateAvailable === true && (
            <span
              className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[9px] font-bold leading-none text-white"
              title={
                hermes.behindCommits != null
                  ? t("{0} commit{1} behind", hermes.behindCommits, hermes.behindCommits === 1 ? "" : "s")
                  : t("Update available")
              }
            >
              {hermes.behindCommits != null ? hermes.behindCommits : "!"}
            </span>
          )}
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-[11px] text-muted hover:bg-surface-hover hover:text-text transition-colors"
        >
          <EditIcon className="h-3 w-3" />
          {t("Edit")}</button>
      )}
    </div>
  );
}
