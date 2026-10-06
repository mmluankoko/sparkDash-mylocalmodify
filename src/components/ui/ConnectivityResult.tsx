import { t, useI18n } from "../../i18n";
import type { SparkTestResponse } from "../../api/types";

export function ConnectivityResult({ result }: { result: SparkTestResponse }) {
  useI18n();
  return (
    <div
      className={`mt-3 rounded px-3 py-2 text-xs ${result.ok ? "bg-success/20" : "bg-danger/20"}`}
      role="status"
    >
      <p className={result.ok ? "text-success" : "text-danger"}>
        {result.ok ? t("All required capabilities passed.") : t("One or more required capabilities failed.")}
      </p>
      <ul className="mt-1 space-y-1">
        {result.capabilities.map((capability) => (
          <li key={capability.id} className={capability.status === "fail" ? "text-danger" : "text-muted"}>
            <strong>{t(capability.label)}:</strong>{" "}
            {capability.status === "pass" ? t("Pass") : capability.status === "fail" ? t("Fail") : t("Skipped")}
            {capability.message ? ` — ${t(capability.message)}` : ""}
            {capability.recovery ? ` ${t(capability.recovery)}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
