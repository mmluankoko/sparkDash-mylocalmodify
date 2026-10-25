import { describe, expect, it, vi } from "vitest";
import { render } from "../../testing/render";
import { makeSpark } from "../../testing/fixtures";
import { LlmPanel } from "./LlmPanel";

vi.mock("./LlmTokenTotals", () => ({ LlmTokenTotals: () => null }));
vi.mock("./LlmDailyChart", () => ({ LlmDailyChart: () => null }));
vi.mock("./LlmTrendChart", () => ({ LlmTrendChart: () => null }));

describe("TensorFold slot tile", () => {
  it.each([null, 0, 8])("renders occupancy %s with known capacity", (active) => {
    const llm = { ...makeSpark().metrics.llm[0], backend: "tensorfold" as const, slotsActive: active, slotsTotal: 8 };
    const { container } = render(<LlmPanel llm={llm} sparkId="fixture" llmPort={8888} />);
    const tile = [...container.querySelectorAll(".sp-tile")].find((el) => el.querySelector("span")?.textContent === "Slots");
    expect(tile?.querySelector("b")?.textContent).toBe(`${active ?? "?"} / 8`);
  });
});

describe("Radiance engine tiles", () => {
  it("shows the vLLM-format KV cache tile with binary memory units", () => {
    const llm = { ...makeSpark().metrics.llm[0], backend: "radiance" as const, kvCacheUsage: 0.25, kvCacheTokens: 1_087_768, kvCacheMemoryBytes: 10 * 1024 ** 3, ttftP95Seconds: 0.4 };
    const { container } = render(<LlmPanel llm={llm} sparkId="fixture" llmPort={8888} />);
    const labels = [...container.querySelectorAll(".sp-tile")].map((el) => el.querySelector("span")?.textContent);
    expect(labels).toContain("KV cache");
    expect(labels).toContain("TTFT p95");
    expect(container.textContent).toContain("10 GiB");
  });

  it("formats a sub-GiB KV pool in MiB", () => {
    const llm = { ...makeSpark().metrics.llm[0], backend: "radiance" as const, kvCacheUsage: 0.25, kvCacheMemoryBytes: 512 * 1024 ** 2 };
    const { container } = render(<LlmPanel llm={llm} sparkId="fixture" llmPort={8888} />);
    expect(container.textContent).toContain("512 MiB");
  });
});
