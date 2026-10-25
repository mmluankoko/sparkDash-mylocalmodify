import { describe, expect, it } from "vitest";
import { OverviewPage } from "./OverviewPage";
import { render } from "../../testing/render";
import type { SparkSnapshot } from "../../api/types";

/** The RTX PRO 6000 host as the live instance reported it. */
function host(overrides: { cpuTemp?: number; cpuUsage?: number; kind?: "spark" | "host" } = {}): SparkSnapshot {
  return {
    id: "rtx-pro-6000",
    name: "RTX PRO 6000",
    kind: overrides.kind ?? "host",
    online: true,
    uptime: 1000,
    disabledDevices: [],
    disabledInterfaces: [],
    llmPort: 30000,
    llmPorts: [30000],
    metrics: {
      gpu: {
        usage: 37,
        temperature: 44,
        vram: { used: 90_000, total: 97_887, available: 7_887, percentage: 92 },
        power: { draw: 80, limit: 600 },
      },
      cpu: {
        temperature: overrides.cpuTemp ?? 0,
        usage: overrides.cpuUsage ?? 0,
        draw: 25,
        tdp: 100,
      },
      ram: { used: 40_000, total: 128_000 },
      storage: [
        { label: "/", device: "nvme1n1p2", used: 836_010, total: 1_875_626, percentage: 44.6 },
      ],
      llm: [{ available: true, backend: "sglang", modelId: "qwen38-exl3-ple8", generationTps: 12, prefillTps: 350 }],
    },
  } as unknown as SparkSnapshot;
}

/** Bar labels in render order. */
function barLabels(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll(
      ".ov-lbl > span:first-child, .space-y-1 > div:first-child > span:first-child"
    ),
  ].map(
    (el) => el.textContent ?? ""
  );
}

describe("Overview card", () => {
  it("names each bar for what it measures", () => {
    const { container } = render(<OverviewPage sparks={[host({ cpuTemp: 51 })]} />);
    expect(barLabels(container)).toEqual(["VRAM", "GPU", "RAM", "GPU temp", "GPU power", "CPU temp", "CPU power"]);
  });

  it("omits the CPU temperature bar when no CPU temperature data exists", () => {
    const { container } = render(<OverviewPage sparks={[host({ kind: "spark" })]} />);
    expect(barLabels(container)).toEqual(["VRAM", "GPU", "GPU temp", "GPU power", "CPU power"]);
  });

  it("puts the head first and sorts the other cards naturally by name", () => {
    const spark02 = { ...host(), id: "02", name: "DGX 02", role: "worker" } as SparkSnapshot;
    const spark10 = { ...host(), id: "10", name: "DGX 10" } as SparkSnapshot;
    const head = { ...host(), id: "head", name: "DGX 99", role: "head" } as SparkSnapshot;
    const spark03 = { ...host(), id: "03", name: "DGX 03" } as SparkSnapshot;
    const { container } = render(<OverviewPage sparks={[spark02, spark10, head, spark03]} />);
    expect([...container.querySelectorAll(".ov-sc__name")].map((el) => el.textContent)).toEqual([
      "DGX 99",
      "DGX 02",
      "DGX 03",
      "DGX 10",
    ]);
  });

  it("mirrors the worker cluster label onto an idle head without showing a launcher", () => {
    const head = { ...host(), id: "head", name: "DGX 01", role: "head" } as SparkSnapshot;
    head.metrics.llm = [];
    const worker = {
      ...host(),
      id: "worker",
      name: "DGX 02",
      role: "worker",
      workerHeadId: "head",
      workerLabel: "cluster01",
    } as SparkSnapshot;
    const { container } = render(<OverviewPage sparks={[worker, head]} />);
    const headCard = container.querySelector(".ov-sc");
    expect(headCard?.querySelector(".ov-launch--worker")?.textContent).toContain("No model loaded on the head");
    expect(headCard?.querySelector(".ov-modelrow code")?.textContent).toBe("cluster01");
    expect(container.textContent).not.toContain("Add a model");
  });

  it("fits a 1.8 TB root disk in the Storage mini-stat", () => {
    const { container } = render(<OverviewPage sparks={[host()]} />);
    const label = [...container.querySelectorAll("span")].find((el) => el.textContent === "Storage");
    const value = label?.nextElementSibling as HTMLElement | null;
    expect(value?.textContent).toBe("816 GB / 1.8 TB");
    expect(value?.title).toBe("816.4 GB of 1831.7 GB used (45%)");
  });

  it("calls SGLang by its name", () => {
    const { container } = render(<OverviewPage sparks={[host()]} />);
    // The engine name rides in the model row's tooltip.
    expect(container.querySelector('[title*="SGLang"]')).not.toBeNull();
    expect(container.innerHTML).not.toContain("sgLang");
  });
});

describe("Overview panels can be hidden", () => {
  const tileLabels = (c: HTMLElement) => [...c.querySelectorAll(".ov-kpi .eyebrow")].map((e) => e.textContent);

  it("shows the four tiles, the cards and Recent activity by default", () => {
    const { container } = render(<OverviewPage sparks={[host()]} />);
    expect(tileLabels(container)).toEqual(["Fleet decode", "Fleet power", "Memory in use", "Online"]);
    expect(container.querySelector('[aria-label="Recent activity"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Inference activity");
  });

  it("counts hidden cluster workers in Fleet power", () => {
    const head = { ...host({ kind: "spark" }), id: "head", role: "head" } as SparkSnapshot;
    const worker = { ...host({ kind: "spark" }), id: "worker", role: "worker" } as SparkSnapshot;
    const { container } = render(<OverviewPage sparks={[head, worker]} hideWorkers />);
    const power = [...container.querySelectorAll(".ov-kpi")].find((k) => k.textContent?.includes("Fleet power"));
    expect(power?.querySelector(".big-num")?.textContent).toContain("160");
  });

  it("hides single tiles and sizes the row to the rest", () => {
    const { container } = render(<OverviewPage sparks={[host()]} kpis={{ decode: false, memory: false }} />);
    expect(tileLabels(container)).toEqual(["Fleet power", "Online"]);
    expect(container.querySelector(".ov-kpis")?.getAttribute("data-count")).toBe("2");
  });

  it("drops the whole tile row when every tile is hidden", () => {
    const { container } = render(
      <OverviewPage sparks={[host()]} kpis={{ decode: false, power: false, memory: false, tokens: false }} />
    );
    expect(container.querySelector(".ov-kpis")).toBeNull();
  });

  it("hides Recent activity, and the side column when nothing is left in it", () => {
    const { container } = render(
      <OverviewPage sparks={[host()]} showActivityFeed={false} showFleetEnergy={false} showLlmTokenTotals={false} />
    );
    expect(container.querySelector('[aria-label="Recent activity"]')).toBeNull();
    expect(container.querySelector(".ov-side")).toBeNull();
  });
});
