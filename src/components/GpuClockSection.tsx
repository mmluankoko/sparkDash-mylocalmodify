import { t, useI18n } from "../i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGpuClock, fetchGpuClockCommand, resetGpuClock, setGpuClock } from "../api/client";
import type { GpuClockStatus } from "../api/types";

const MIN_CAP_MHZ = 300;

type Ready = Extract<GpuClockStatus, { supported: true }>;

/** Highest clock a boot hook applies, e.g. "0,2200" -> 2200. */
function bootMax(status: Ready): number | null {
  const m = /^\d+,(\d+)$/.exec(status.service.clocks ?? status.cron.clocks ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * GPU clock cap for one Spark (Edit unit). Acts immediately on the unit with the
 * saved connection settings: it is not part of the Save button.
 */
export function GpuClockSection({ sparkId }: { sparkId: string }) {
  useI18n();
  const [status, setStatus] = useState<GpuClockStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [maxInput, setMaxInput] = useState("");
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  /** Command for running the change by hand on the unit (plain sudo, asks for the password). */
  const [manual, setManual] = useState<{ title: string; command: string } | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Typed sudo password: kept in this component's state only, sent with one request, then cleared. */
  const [sudoPw, setSudoPw] = useState("");
  /** Only the newest request may write state: a slow answer for an older unit must not win. */
  const latest = useRef(0);
  const sparkRef = useRef(sparkId);
  sparkRef.current = sparkId;

  const syncInputs = (s: GpuClockStatus) => {
    if (!s.supported) return;
    const cap = s.capMHz ?? bootMax(s);
    setMaxInput(cap != null ? String(cap) : "");
    setPersist(s.service.installed || s.cron.installed);
  };

  const load = useCallback(
    async (opts: { sync: boolean }) => {
      const mine = ++latest.current;
      try {
        const s = await fetchGpuClock(sparkId);
        if (mine !== latest.current) return;
        setStatus(s);
        setLoadError(null);
        if (opts.sync) syncInputs(s);
      } catch (err) {
        if (mine !== latest.current) return;
        // Keep what is on screen after a failed refresh; the message says what went wrong.
        setLoadError(err instanceof Error ? err.message : t("Could not read the GPU clock cap"));
      }
    },
    [sparkId]
  );

  useEffect(() => {
    setStatus(null);
    setLoadError(null);
    setMessage(null);
    setMaxInput("");
    setPersist(false);
    setManual(null);
    setManualError(null);
    setSudoPw("");
    setBusy(false);
    void load({ sync: true });
    return () => {
      latest.current += 1;
    };
  }, [load]);

  if (!status) {
    return (
      <div className="gpu-clock">
        <span className="field-label">{t("GPU clock cap")}</span>
        <p className={`field-hint${loadError ? " is-warn" : ""}`} role="status">
          {loadError ?? t("Reading the unit…")}
        </p>
      </div>
    );
  }
  if (!status.supported) {
    return (
      <div className="gpu-clock">
        <span className="field-label">{t("GPU clock cap")}</span>
        <p className="field-hint">{status.reason || t("Not available on this unit.")}</p>
      </div>
    );
  }

  const hwMax = status.hwMaxMHz;
  const maxMHz = Number(maxInput);
  const valid =
    maxInput.trim() !== "" &&
    Number.isInteger(maxMHz) &&
    maxMHz >= MIN_CAP_MHZ &&
    (hwMax == null || maxMHz <= hwMax);
  const sudoMissing = status.sudo === "no";
  /** A password typed here crosses the network: only over https or from the machine itself. */
  const secure =
    (typeof window === "undefined" || window.isSecureContext !== false) && status.passwordAllowed !== false;
  const needPw = sudoMissing && secure;
  const pwOk = !needPw || sudoPw.length > 0;
  const pwArg = needPw ? sudoPw : undefined;
  /**
   * No boot hook is reachable here at all: the checkbox says so instead of refusing on Apply.
   * Without passwordless sudo the status cannot probe for one, so a typed password decides it on the unit.
   */
  const cannotPersist = !sudoMissing && status.persistKind === "none";

  /** How this unit keeps the cap, as the response reported it. */
  const keptText = (kind: string) =>
    kind === "cron" ? t("kept after reboot by an @reboot cron job") : t("kept after reboot by a boot service");

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await action() });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("The unit refused the change") });
    } finally {
      // A slow answer for the unit you just left must not wipe what you type for this one.
      if (sparkRef.current === sparkId) {
        setBusy(false);
        setSudoPw("");
        await load({ sync: true });
      }
    }
  };

  const apply = () => {
    const how = status.persistKind === "cron" ? t("an @reboot cron job") : t("a system service");
    if (persist && !confirm(t("Keep the cap after reboot with {0}? It re-applies the cap at every boot on this unit.", how)))
      return;
    void run(async () => {
      const out = await setGpuClock(sparkId, { maxMHz, persist, ...(pwArg ? { sudoPassword: pwArg } : {}) });
      return persist
        ? t("Capped at {0} MHz and {1}.", maxMHz, keptText(out.persistKind))
        : t("Capped at {0} MHz until the next reboot.", maxMHz);
    });
  };

  const remove = () => {
    if (!confirm(t("Remove the GPU clock cap and its boot hook from this unit?"))) return;
    void run(async () => {
      await resetGpuClock(sparkId, pwArg);
      return t("Cap removed.");
    });
  };

  const showCommand = async (kind: "apply" | "reset") => {
    setManualError(null);
    setCopied(false);
    try {
      const q = kind === "apply" ? ({ action: "apply", maxMHz, persist } as const) : ({ action: "reset" } as const);
      const { command } = await fetchGpuClockCommand(sparkId, q);
      setManual({
        title: kind === "apply" ? `${t("Cap at {0} MHz", maxMHz)}${persist ? ` ${t("and keep after reboot")}` : ""}` : t("Remove the cap"),
        command,
      });
    } catch (err) {
      setManual(null);
      setManualError(err instanceof Error ? err.message : t("Could not build the command"));
    }
  };

  const copyCommand = async () => {
    if (!manual) return;
    try {
      await navigator.clipboard.writeText(manual.command);
      setCopied(true);
    } catch {
      // Plain-http dashboards have no clipboard API: the text box below is selectable.
      setCopied(false);
    }
  };

  return (
    <div className="gpu-clock">
      <label className="field-label" htmlFor="gpu-clock-max">
        {t("GPU clock cap")}
      </label>
      <p className="gpu-clock__now" data-testid="gpu-clock-now">
        {status.capMHz != null ? (
          <>
            {t("Capped at")} <b>{status.capMHz} {t("MHz")}</b>
            {hwMax != null ? ` (${t("GPU maximum {0} MHz", hwMax)})` : ""}
          </>
        ) : (
          <>{t("No cap in effect")}{hwMax != null ? ` (${t("GPU maximum {0} MHz", hwMax)})` : ""}</>
        )}
        {status.service.installed
          ? t(" · boot service {0}{1}", status.service.enabled === "enabled" ? t("enabled") : status.service.enabled ? t(status.service.enabled) : t("installed"), status.service.clocks ? ` (${status.service.clocks} MHz)` : "")
          : status.cron.installed
            ? t(" · @reboot job{0}", status.cron.clocks ? ` (${status.cron.clocks} MHz)` : "")
            : t(" · not kept after reboot")}
      </p>
      {status.cron.installed && status.cron.failed ? (
        <p className="field-hint is-warn" role="alert" data-testid="gpu-clock-boot-failed">
          {t("The @reboot job ran at this boot and could not re-apply the cap, so the GPU is not capped. Press Apply to cap it again, or check that")} <code>sudo -n nvidia-smi -lgc</code> {t("still works for this user.")}
        </p>
      ) : null}
      <div className="gpu-clock__row">
        <input
          id="gpu-clock-max"
          type="number"
          min={MIN_CAP_MHZ}
          max={hwMax ?? undefined}
          inputMode="numeric"
          placeholder={hwMax != null ? `${MIN_CAP_MHZ}–${hwMax}` : t("MHz")}
          value={maxInput}
          onChange={(e) => setMaxInput(e.target.value)}
          disabled={busy}
        />
        <span className="gpu-clock__unit">{t("MHz max")}</span>
        <button type="button" className="btn btn--sm" onClick={apply} disabled={busy || !valid || !pwOk || (sudoMissing && !secure)}>
          {busy ? t("Working…") : t("Apply")}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={remove} disabled={busy || !pwOk || (sudoMissing && !secure)}>
          {t("Remove limit")}
        </button>
      </div>
      <label className="gpu-clock__check">
        <input
          type="checkbox"
          checked={persist}
          onChange={(e) => setPersist(e.target.checked)}
          disabled={busy || (cannotPersist && !persist)}
        />
        {t("Keep after reboot")} (
        {cannotPersist
          ? t("not available on this unit")
          : status.persistKind === "cron"
            ? t("an @reboot cron job")
            : t("a system service")}
        )
      </label>
      {needPw && (
        <div>
          <label className="field-label" htmlFor="gpu-clock-sudo-pw">
            {t("sudo password for this unit")}
          </label>
          <input
            id="gpu-clock-sudo-pw"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            value={sudoPw}
            onChange={(e) => setSudoPw(e.target.value)}
            disabled={busy}
            placeholder={t("used for this change only")}
          />
          <p className="field-hint">
            {t("This unit has no passwordless sudo. The password is sent once, over this connection, to run the change, then discarded: it is never stored or logged.")}
          </p>
        </div>
      )}
      {sudoMissing && !secure && (
        <p className="field-hint is-warn">
          {t("This connection is not on https or the machine itself, so a sudo password is not typed here (it would cross the network in the clear). Open the dashboard over https or from the Spark itself, run the change on the Spark with the command below, or give that user passwordless sudo for")} <code>nvidia-smi -lgc</code> {t("and")} <code>-rgc</code>{" "}
          — {t("a rule for those two commands is enough.")}
        </p>
      )}
      {!sudoMissing && (
        <p className="field-hint">
          {t("Runs")} <code>{t("nvidia-smi -lgc 0,MAX")}</code>{status.sudo === "root" ? t(" as root on this machine") : t(" through sudo")}{t(", using the saved connection settings. Applies at once; it is not part of Save.")}
        </p>
      )}
      {cannotPersist ? (
        <p className="field-hint is-warn">
          {t("Keeping the cap after reboot needs either passwordless sudo for a root shell (the boot service) or a running cron service (an @reboot job), and this unit offers neither. The cap applies until the next reboot.")}
        </p>
      ) : null}
      {maxInput.trim() !== "" && !valid && (
        <p className="field-hint is-warn">
          {t("Enter a whole number from {0}{1}.", MIN_CAP_MHZ, hwMax != null ? t(" to {0}", hwMax) : "")}
        </p>
      )}
      <details className="gpu-clock__manual" open={(sudoMissing && !secure) || manual != null}>
        <summary>{t("Run it on the Spark yourself")}</summary>
        <p className="field-hint">
          {t("Paste the command into a terminal on the Spark. It uses plain")} <code>sudo</code>, {t("so it asks for your password there. It is the same steps the Apply and Remove buttons run.")}
        </p>
        <div className="gpu-clock__row">
          <button type="button" className="btn btn--sm" onClick={() => void showCommand("apply")} disabled={!valid}>
            {t("Show command: apply")}
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => void showCommand("reset")}>
            {t("Show command: remove")}
          </button>
        </div>
        {manualError && <p className="field-hint is-warn" role="status">{manualError}</p>}
        {manual && (
          <>
            <p className="gpu-clock__now">{manual.title}</p>
            <textarea className="gpu-clock__command" readOnly rows={8} value={manual.command} aria-label={t("Command to run on the Spark")} onFocus={(e) => e.currentTarget.select()} />
            <div className="gpu-clock__row">
              <button type="button" className="btn btn--sm" onClick={() => void copyCommand()}>
                {copied ? t("Copied") : t("Copy")}
              </button>
            </div>
          </>
        )}
      </details>
      {loadError && <p className="field-hint is-warn" role="status">{t("Could not refresh:")} {loadError}</p>}
      {message && (
        <p className={`field-hint ${message.ok ? "is-ok" : "is-warn"}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
