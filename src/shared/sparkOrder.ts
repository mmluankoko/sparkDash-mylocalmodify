import type { SparkSnapshot } from "../api/types";
import { resolveSparkRole } from "../api/sparkRole";

export function compareSparks(a: SparkSnapshot, b: SparkSnapshot): number {
  return (
    Number(resolveSparkRole(b) === "head") - Number(resolveSparkRole(a) === "head") ||
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) ||
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );
}
