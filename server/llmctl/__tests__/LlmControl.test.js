import test from "node:test";
import assert from "node:assert/strict";
import {
  LlmControlManager,
  parseLauncherStatus,
  normalizeUnitConfig,
} from "../LlmControl.js";

const SPARK = { id: "dgx01", name: "dgx01", isLocal: false, lanIp: "10.100.176.2", ssh: { host: "10.100.176.2", user: "edison", auth: "key" } };

function makeRegistry() {
  return { getSpark: (id) => (id === "dgx01" ? SPARK : null) };
}

function makeConfig(dir = "/home/edison/LLMRT/a") {
  return {
    units: {
      dgx01: {
        port: 8888,
        rankLabels: ["dgx01", "dgx02"],
        services: [
          { name: "svc-a", label: "A", engine: "vllm", dir, start: "bin/start.sh", stop: "bin/stop.sh", status: "bin/status.sh" },
          { name: "svc-b", label: "B", engine: "sglang", dir, args: "--profile fp8", start: "bin/start-b.sh", stop: "bin/stop.sh", status: "bin/status.sh" },
        ],
      },
    },
  };
}

/** Manager with scripted sshExec + probe. Returns handles for driving polls. */
function makeManager({ config, outputs, probeResults }) {
  const calls = [];
  let step = 0;
  const execFn = async (_spark, cmd) => {
    calls.push(cmd);
    const out = outputs[Math.min(step, outputs.length - 1)];
    step += 1;
    const resolved = typeof out === "function" ? out(cmd) : out;
    if (resolved instanceof Error) throw resolved;
    return resolved ?? "";
  };
  let probeStep = 0;
  const probeFn = async () => probeResults[Math.min(probeStep++, probeResults.length - 1)] ?? false;
  const mgr = new LlmControlManager({
    registry: makeRegistry(),
    config,
    execFn,
    probeFn,
    nowFn: () => 1_000_000,
    pollIntervalMs: 1_000_000, // no background ticking during tests
  });
  return { mgr, calls, execFn, probeFn };
}

test("parseLauncherStatus handles CJK colon and rank lines", () => {
  const out = [
    "rank 0：miaai-qwen38-27b-dual-nvfp4 exited dd6cc237bdd3",
    "rank 1：miaai-qwen38-27b-dual-nvfp4 exited 4a6d923d17c6",
  ].join("\n");
  const ranks = parseLauncherStatus(out);
  assert.equal(ranks.length, 2);
  assert.deepEqual(ranks[0], { rank: 0, container: "miaai-qwen38-27b-dual-nvfp4", state: "exited" });
  assert.equal(ranks[1].rank, 1);
});

test("parseLauncherStatus returns empty on garbage", () => {
  assert.deepEqual(parseLauncherStatus("some random output\nno ranks here"), []);
  assert.deepEqual(parseLauncherStatus(""), []);
});

test("normalizeUnitConfig validates paths and keeps args", () => {
  const unit = normalizeUnitConfig("dgx01", makeConfig().units.dgx01);
  assert.equal(unit.port, 8888);
  assert.equal(unit.services[1].args, "--profile fp8");
  assert.equal(unit.services[0].start, "/home/edison/LLMRT/a/bin/start.sh");
  assert.throws(() => normalizeUnitConfig("x", { port: 0, services: [] }));
  assert.throws(() =>
    normalizeUnitConfig("x", { port: 8888, services: [{ name: "bad name; rm -rf", dir: "/o", start: "s", stop: "s", status: "s" }] })
  );
  assert.throws(() =>
    normalizeUnitConfig("x", { port: 8888, services: [{ name: "ok", dir: "/o; touch /tmp/pwned", start: "s", stop: "s", status: "s" }] })
  );
});

test("poll derives stopped → starting → loading → ready from status + probe", async () => {
  // Poll sequence: 1) launcher pre-flight (no containers), 2) containers up
  // but port closed (weight load), 3) port answering → ready.
  const running = "rank 0：c-a running abc123\nrank 1：c-a running def456";
  const { mgr } = makeManager({
    config: makeConfig(),
    outputs: ["", "", running, running, running],
    probeResults: [false, false, false, true, true],
  });
  const state = mgr._svcEntry("dgx01", mgr.units.get("dgx01"), "svc-a").state;
  state.status = "starting";
  state.startedAt = 990_000;
  state.pid = 4242;

  const unit = mgr.units.get("dgx01");
  await mgr.pollUnit(SPARK, unit, "dgx01"); // pre-flight → stays starting
  assert.equal(state.status, "starting");
  await mgr.pollUnit(SPARK, unit, "dgx01"); // pre-flight → stays starting
  assert.equal(state.status, "starting");
  await mgr.pollUnit(SPARK, unit, "dgx01"); // containers up, port closed → loading
  assert.equal(state.status, "loading");
  await mgr.pollUnit(SPARK, unit, "dgx01"); // port up → ready
  assert.equal(state.status, "ready");
  assert.equal(state.readyAt, 1_000_000);
});

test("containers exiting during startup marks failed", async () => {
  const exited = "rank 0：c-a exited abc123";
  const { mgr } = makeManager({
    config: makeConfig(),
    outputs: [exited, exited],
    probeResults: [false, false],
  });
  const state = mgr._svcEntry("dgx01", mgr.units.get("dgx01"), "svc-a").state;
  state.status = "starting";
  await mgr.pollUnit(SPARK, mgr.units.get("dgx01"), "dgx01");
  assert.equal(state.status, "failed");
  assert.match(state.lastError, /check logs/);
});

test("PID death while starting fails the service", async () => {
  const { mgr } = makeManager({
    config: makeConfig(),
    outputs: [() => "", () => "---MARK------MARK---PID_DEAD"],
    probeResults: [false, false],
  });
  const entry = mgr._svcEntry("dgx01", mgr.units.get("dgx01"), "svc-a");
  entry.state.status = "starting";
  entry.state.pid = 4242;
  await mgr.pollUnit(SPARK, mgr.units.get("dgx01"), "dgx01"); // still alive
  assert.equal(entry.state.status, "starting");
  await mgr.pollUnit(SPARK, mgr.units.get("dgx01"), "dgx01"); // PID gone
  assert.equal(entry.state.status, "failed");
  assert.match(entry.state.lastError, /launcher exited/);
});

test("start records PID and detaches via nohup; slot mutex blocks second start", async () => {
  const { mgr, calls } = makeManager({
    config: makeConfig(),
    outputs: ["PID:777"],
    probeResults: [false],
  });
  const r = await mgr.start("dgx01", "svc-a");
  assert.equal(r.ok, true);
  assert.match(calls[0], /nohup bash '\/home\/edison\/LLMRT\/a\/bin\/start\.sh'/);
  assert.match(calls[0], /PID:\$!/);
  const state = mgr.state.get("dgx01").get("svc-a");
  assert.equal(state.status, "starting");
  assert.equal(state.pid, 777);

  // Another service may not start while the slot is held.
  const r2 = await mgr.start("dgx01", "svc-b");
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /slot busy/);
  // Nor the same one twice.
  const r3 = await mgr.start("dgx01", "svc-a");
  assert.equal(r3.ok, false);
  assert.match(r3.reason, /is starting/);
});

test("start appends profile args for multi-profile launchers", async () => {
  const { mgr, calls } = makeManager({
    config: makeConfig(),
    outputs: ["PID:1", "PID:2"],
    probeResults: [false],
  });
  await mgr.start("dgx01", "svc-a");
  const stateA = mgr.state.get("dgx01").get("svc-a");
  stateA.status = "stopped"; // reset for svc-b attempt
  await mgr.start("dgx01", "svc-b");
  assert.match(calls[1], /bin\/start-b\.sh' --profile fp8/);
});

test("stop runs synchronously and poll confirms stopped", async () => {
  const running = "rank 0：c-a running abc123\nrank 1：c-a running def456";
  const none = "";
  const { mgr } = makeManager({
    config: makeConfig(),
    outputs: [running, none],
    probeResults: [true, false],
  });
  const state = mgr.state.get("dgx01").get("svc-a");
  // Externally running (no in-memory state): derived as ready.
  await mgr.pollUnit(SPARK, mgr.units.get("dgx01"), "dgx01");
  assert.equal(state.status, "ready");
  const r = await mgr.stop("dgx01", "svc-a");
  assert.equal(r.ok, true);
  assert.equal(state.status, "stopping");
  await mgr.pollUnit(SPARK, mgr.units.get("dgx01"), "dgx01");
  assert.equal(state.status, "stopped");
});

test("stop refuses when nothing is running", async () => {
  const { mgr } = makeManager({ config: makeConfig(), outputs: [""], probeResults: [false] });
  const r = await mgr.stop("dgx01", "svc-a");
  assert.equal(r.ok, false);
  assert.match(r.reason, /not running/);
});

test("SSH failure marks unknown and keeps prior timestamps", async () => {
  const { mgr } = makeManager({
    config: makeConfig(),
    outputs: [new Error("connection refused")],
    probeResults: [false],
  });
  const state = mgr.state.get("dgx01").get("svc-a");
  state.status = "ready";
  state.readyAt = 123;
  await mgr.pollUnit(SPARK, mgr.units.get("dgx01"), "dgx01");
  assert.equal(state.status, "unknown");
  assert.match(state.lastError, /status poll failed/);
  assert.equal(state.readyAt, 123);
});

test("externally started service is picked up by polling", async () => {
  const running = "rank 0：c-a running abc123\nrank 1：c-a running def456";
  const { mgr } = makeManager({
    config: makeConfig(),
    outputs: [running, running],
    probeResults: [false, true],
  });
  const state = mgr.state.get("dgx01").get("svc-a");
  await mgr.pollUnit(SPARK, mgr.units.get("dgx01"), "dgx01");
  assert.equal(state.status, "loading");
  await mgr.pollUnit(SPARK, mgr.units.get("dgx01"), "dgx01");
  assert.equal(state.status, "ready");
});

test("snapshot exposes labels, ranks and slow flag", async () => {
  const running = "rank 0：c-a running abc123\nrank 1：c-a running def456";
  const { mgr } = makeManager({
    config: makeConfig(),
    outputs: [running],
    probeResults: [false],
  });
  await mgr.pollUnit(SPARK, mgr.units.get("dgx01"), "dgx01");
  const snap = mgr.snapshot();
  assert.equal(snap.length, 1);
  const unit = snap[0];
  assert.equal(unit.sparkName, "dgx01");
  assert.deepEqual(unit.rankLabels, ["dgx01", "dgx02"]);
  const svc = unit.services[0];
  assert.equal(svc.label, "A");
  assert.equal(svc.status, "loading");
  assert.equal(svc.ranks.length, 2);
  assert.equal(svc.slow, false);
});
