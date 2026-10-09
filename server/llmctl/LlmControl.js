/**
 * LLM service control — start/stop LLMRT deployments via SSH.
 *
 * Design principles:
 * - The web UI never sends command strings. Every command is built from the
 *   allowlisted `config/llm-services.json` registry (script paths only).
 * - The remote LLMRT `launcher.py` shims (bin/start-*.sh / stop.sh / status.sh)
 *   own all deployment logic, GPU mutual exclusion and stop timeouts. This
 *   module only orchestrates and derives UI state.
 * - Truth lives on the remote host. In-memory runtime state is a cache and is
 *   re-derived from `status.sh` + a port probe every poll, so externally
 *   started/stopped services are still reported correctly.
 * - `logs` is fetched directly via `docker logs --tail N` (the LLMRT
 *   `tail-log.sh` follows with `-f` and never returns — unusable for polling).
 *
 * Service status lifecycle (per spark+service):
 *   stopped → starting → loading → ready → stopping → stopped
 *                                     ↘ failed (launcher died / port never opened)
 * `loading` = containers up but the OpenAI API not answering yet (weight load).
 * `ready`   = at least one rank container running AND the API port answering.
 */

import fs from "fs";
import { sshExec } from "../collectors/ssh.js";
import { llmProbeHost } from "../collectors/llmHost.js";
import { isAllowedTargetHost } from "../validate.js";
import { LLM_SERVICES_JSON_PATH } from "../config.js";

/** Docker container states reported by `docker ps` / launcher status output. */
const DOCKER_STATES = new Set([
  "created",
  "running",
  "paused",
  "restarting",
  "removing",
  "dead",
  "exited",
]);

/** Shell-safe charset for allowlisted paths (no quotes, no metacharacters). */
const SAFE_PATH_RE = /^[A-Za-z0-9_@%+=:,./-]+$/;
/** Shell-safe charset for optional launcher args (e.g. `--profile fp8`). */
const SAFE_ARGS_RE = /^[A-Za-z0-9._= -]*$/;
/** Container names come from remote output — sanitize before shell embedding. */
const CONTAINER_RE = /^[A-Za-z0-9_.-]+$/;

const START_LOG_DIR = "/tmp/sparkdash-llmctl";
const POLL_INTERVAL_MS = 3000;
/** How long a start may stay loading before the UI hints at the logs. */
export const START_SLOW_WARN_MS = 15 * 60 * 1000;
/** sshExec timeout for the synchronous stop call (launcher's own timeout is 30s). */
const STOP_TIMEOUT_MS = 90_000;

/**
 * Parse `launcher.py status` output. Expected line shape (head-only example):
 *   rank 0：miaai-qwen38-27b-dual-nvfp4 exited dd6cc237bdd3
 * Returns an array of { rank, container, state } sorted by rank.
 *
 * @param {string} output
 * @returns {{ rank: number, container: string, state: string }[]}
 */
export function parseLauncherStatus(output) {
  const ranks = [];
  if (!output) return ranks;
  const seen = new Set();
  for (const line of String(output).split("\n")) {
    const m = line.match(/^rank\s+(\d+)\s*[:：]\s*(\S+)\s+(\S+)(?:\s+(\S+))?/);
    if (!m) continue;
    const rank = parseInt(m[1], 10);
    const tokens = [m[2], m[3], m[4]].filter(Boolean);
    // The state word is whichever token matches a known docker state; the rest
    // are container name / short id (order varies across launcher versions).
    const stateIdx = tokens.findIndex((tok) => DOCKER_STATES.has(tok));
    if (stateIdx === -1 || seen.has(rank)) continue;
    const state = tokens[stateIdx];
    const container = tokens.find((tok, i) => i !== stateIdx) || null;
    seen.add(rank);
    ranks.push({ rank, container, state });
  }
  ranks.sort((a, b) => a.rank - b.rank);
  return ranks;
}

/**
 * Parse a `script`-kind control status output (e.g. ComfyRT control.py):
 *   "ComfyUI stopped" / "ComfyUI running, PID 123" /
 *   "HTTP endpoint is not ready; see logs/comfyui.log"
 * Returns a single synthetic rank so the UI treats it like one container.
 *
 * @param {string} output
 * @returns {{ rank: number, container: string|null, state: string, pid: number|null }[]}
 */
export function parseScriptStatus(output) {
  const text = String(output || "");
  const pidMatch = text.match(/\bPID (\d+)/);
  const pid = pidMatch ? parseInt(pidMatch[1], 10) : null;
  if (/\brunning\b/i.test(text) || pidMatch) {
    return [{ rank: 0, container: null, state: "running", pid }];
  }
  if (/\bstopped\b/i.test(text)) {
    return [{ rank: 0, container: null, state: "exited", pid: null }];
  }
  return [];
}

/**
 * Normalize a config unit entry; throws on anything unsafe.
 *
 * @param {string} sparkId
 * @param {unknown} raw
 * @returns {{ port: number, rankLabels: string[], services: object[] }}
 */
export function normalizeUnitConfig(sparkId, raw) {
  if (!raw || typeof raw !== "object") throw new Error(`llm-services: unit ${sparkId} is not an object`);
  const port = Number(raw.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`llm-services: unit ${sparkId} has invalid port`);
  }
  const rankLabels = Array.isArray(raw.rankLabels)
    ? raw.rankLabels.map((s, i) => (typeof s === "string" && s ? s : `rank${i}`))
    : [];
  const services = Array.isArray(raw.services) ? raw.services : [];
  const normalized = services.map((svc, i) => {
    const name = typeof svc?.name === "string" ? svc.name.trim() : "";
    if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw new Error(`llm-services: ${sparkId} service #${i} has an invalid name`);
    }
    const dir = typeof svc?.dir === "string" ? svc.dir.trim() : "";
    if (!dir.startsWith("/") || !SAFE_PATH_RE.test(dir)) {
      throw new Error(`llm-services: ${sparkId}/${name} has an unsafe dir path`);
    }
    const args = typeof svc?.args === "string" ? svc.args.trim() : "";
    if (!SAFE_ARGS_RE.test(args)) {
      throw new Error(`llm-services: ${sparkId}/${name} has unsafe args`);
    }
    // Optional served modelId (what the API reports in /v1/models); used by
    // the control page to resolve the global display name even when stopped.
    const modelId = typeof svc?.modelId === "string" ? svc.modelId.trim() : "";
    if (modelId && !/^[A-Za-z0-9._/-]+$/.test(modelId)) {
      throw new Error(`llm-services: ${sparkId}/${name} has an invalid modelId`);
    }
    const out = { name, label: svc.label || "", engine: svc.engine || "", dir, args, modelId };
    // Service kind: "llmrt" (default) = LLMRT launcher shims with per-rank
    // docker status; "script" = plain control scripts (e.g. ComfyRT), single
    // process, status text like "ComfyUI running, PID N", logs from a file.
    const kind = svc?.kind === "script" ? "script" : "llmrt";
    out.kind = kind;
    // Optional per-service port override (ComfyUI lives on its own port).
    const port = Number(svc?.port);
    if (svc?.port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new Error(`llm-services: ${sparkId}/${name} has an invalid port`);
    }
    out.port = svc?.port != null ? port : null;
    // HTTP path used by the readiness probe (default by kind).
    const probePath = typeof svc?.probePath === "string" ? svc.probePath.trim() : "";
    if (probePath && !/^[A-Za-z0-9._\/?=&-]*$/.test(probePath)) {
      throw new Error(`llm-services: ${sparkId}/${name} has an unsafe probePath`);
    }
    out.probePath = probePath || (kind === "script" ? "/" : "/v1/models");
    // script kind: log file path for tailing (no docker logs).
    const logFile = typeof svc?.logFile === "string" ? svc.logFile.trim() : "";
    if (logFile && (!logFile.startsWith("/") || !SAFE_PATH_RE.test(logFile))) {
      throw new Error(`llm-services: ${sparkId}/${name} has an unsafe logFile path`);
    }
    out.logFile = logFile;
    if (kind === "script" && !logFile) {
      throw new Error(`llm-services: ${sparkId}/${name} (script kind) requires logFile`);
    }
    for (const key of ["start", "stop", "status"]) {
      const rel = typeof svc?.[key] === "string" ? svc[key].trim() : "";
      if (!rel || !SAFE_PATH_RE.test(rel)) {
        throw new Error(`llm-services: ${sparkId}/${name} has an unsafe ${key} path`);
      }
      out[key] = `${dir}/${rel}`;
    }
    return out;
  });
  return { port, rankLabels, services: normalized };
}

/** Strip ANSI escape codes from log lines (docker/ComfyUI colorize output). */
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Quote a validated path for single-quoted shell embedding. */
function shq(p) {
  return `'${p}'`;
}

function freshState() {
  return {
    status: "unknown",
    ranks: [],
    pid: null,
    startedAt: null,
    readyAt: null,
    lastAction: null,
    lastActionAt: null,
    lastError: null,
  };
}

export class LlmControlManager {
  /**
   * @param {{
   *   registry: import("../sparks/SparkRegistry.js").SparkRegistry,
   *   configPath?: string,
   *   config?: object,
   *   execFn?: typeof sshExec,
   *   probeFn?: (spark: object, port: number) => Promise<boolean>,
   *   nowFn?: () => number,
   *   pollIntervalMs?: number,
   * }} opts
   */
  constructor({ registry, configPath = LLM_SERVICES_JSON_PATH, config, execFn = sshExec, probeFn, nowFn = Date.now, pollIntervalMs = POLL_INTERVAL_MS }) {
    this.registry = registry;
    this.execFn = execFn;
    this.nowFn = nowFn;
    this.pollIntervalMs = pollIntervalMs;
    this.probeFn =
      probeFn ||
      (async (spark, port, probePath = "/v1/models") => {
        const host = llmProbeHost(spark);
        if (!host || !isAllowedTargetHost(host)) return false;
        try {
          const res = await fetch(`http://${host}:${port}${probePath || "/v1/models"}`, {
            signal: AbortSignal.timeout(4000),
          });
          // 200 OK or 401 (auth required) both prove the server is answering.
          return res.status < 500;
        } catch {
          return false;
        }
      });
    this.timer = null;
    this.polling = false;
    /** @type {Map<string, { port: number, rankLabels: string[], services: object[] }>} */
    this.units = new Map();
    /** @type {Map<string, Map<string, object>>} sparkId → serviceName → runtime state */
    this.state = new Map();
    if (config) {
      this.applyConfig(config);
    } else {
      this.loadConfig(configPath);
    }
    if (this.units.size > 0) {
      this.timer = setInterval(() => void this.pollAll(), pollIntervalMs);
      this.timer.unref?.();
    }
  }

  /** Apply an already-parsed config object (used by tests). */
  applyConfig(raw) {
    const entries = raw?.units && typeof raw.units === "object" ? Object.entries(raw.units) : [];
    for (const [sparkId, unitRaw] of entries) {
      const spark = this.registry.getSpark(sparkId);
      if (!spark) continue;
      this.units.set(sparkId, normalizeUnitConfig(sparkId, unitRaw));
      if (!this.state.has(sparkId)) this.state.set(sparkId, new Map());
      const svcMap = this.state.get(sparkId);
      for (const svc of this.units.get(sparkId).services) {
        if (!svcMap.has(svc.name)) svcMap.set(svc.name, freshState());
      }
    }
  }

  /** Load and validate the allowlist config. Throws with a readable message. */
  loadConfig(configPath = LLM_SERVICES_JSON_PATH) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
      throw new Error(`llm-services: cannot read ${configPath}: ${err.message}`);
    }
    const entries = raw?.units && typeof raw.units === "object" ? Object.entries(raw.units) : [];
    for (const [sparkId, unitRaw] of entries) {
      const spark = this.registry.getSpark(sparkId);
      if (!spark) continue; // silently skip units that no longer exist
      this.units.set(sparkId, normalizeUnitConfig(sparkId, unitRaw));
      if (!this.state.has(sparkId)) this.state.set(sparkId, new Map());
      const svcMap = this.state.get(sparkId);
      for (const svc of this.units.get(sparkId).services) {
        if (!svcMap.has(svc.name)) svcMap.set(svc.name, freshState());
      }
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Whether any unit is configured (drives frontend tab visibility). */
  get enabled() {
    return this.units.size > 0;
  }

  /** Full status payload for all configured units. */
  snapshot() {
    const out = [];
    for (const [sparkId, unit] of this.units) {
      const spark = this.registry.getSpark(sparkId);
      const svcMap = this.state.get(sparkId) || new Map();
      out.push({
        sparkId,
        sparkName: spark?.name || sparkId,
        port: unit.port,
        rankLabels: unit.rankLabels,
        services: unit.services.map((svc) => {
          const s = svcMap.get(svc.name) || {};
          return {
            name: svc.name,
            label: svc.label,
            engine: svc.engine,
            modelId: svc.modelId || null,
            kind: svc.kind,
            port: svc.port ?? unit.port,
            status: s.status || "unknown",
            ranks: s.ranks || [],
            startedAt: s.startedAt ?? null,
            readyAt: s.readyAt ?? null,
            lastAction: s.lastAction ?? null,
            lastActionAt: s.lastActionAt ?? null,
            lastError: s.lastError ?? null,
            slow:
              (s.status === "loading" || s.status === "starting") &&
              s.startedAt != null &&
              this.nowFn() - s.startedAt > START_SLOW_WARN_MS,
          };
        }),
      });
    }
    return out;
  }

  _svcEntry(sparkId, unit, name) {
    const svc = unit.services.find((s) => s.name === name);
    if (!svc) return null;
    let svcMap = this.state.get(sparkId);
    if (!svcMap) {
      svcMap = new Map();
      this.state.set(sparkId, svcMap);
    }
    if (!svcMap.has(name)) svcMap.set(name, freshState());
    return { svc, state: svcMap.get(name) };
  }

  /**
   * Cross-service mutual exclusion: while any service on the unit is
   * starting/loading/ready/stopping, starting a different one is refused.
   * (The LLMRT launcher enforces the same rule authoritatively; this is the
   * first line of defense so the UI can grey buttons and fail fast.)
   */
  _slotHolder(sparkId, exceptName = null) {
    const unit = this.units.get(sparkId);
    const svcMap = this.state.get(sparkId);
    if (!unit || !svcMap) return null;
    for (const svc of unit.services) {
      if (svc.name === exceptName) continue;
      const st = svcMap.get(svc.name)?.status;
      if (st === "starting" || st === "loading" || st === "ready" || st === "stopping") {
        return svc;
      }
    }
    return null;
  }

  /**
   * Start a service. Detaches the launcher via nohup and returns immediately;
   * the poll loop tracks loading → ready / failed.
   *
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async start(sparkId, name) {
    const unit = this.units.get(sparkId);
    const spark = this.registry.getSpark(sparkId);
    if (!unit || !spark) return { ok: false, reason: "not configured" };
    const entry = this._svcEntry(sparkId, unit, name);
    if (!entry) return { ok: false, reason: "unknown service" };
    const { svc, state } = entry;

    const busy = this._slotHolder(sparkId, name);
    if (busy) {
      return { ok: false, reason: `slot busy: ${busy.name} is ${this.state.get(sparkId).get(busy.name)?.status}` };
    }
    if (["starting", "loading", "ready", "stopping"].includes(state.status)) {
      return { ok: false, reason: `${name} is ${state.status}` };
    }

    const logFile = `${START_LOG_DIR}/${name}.log`;
    // Detach rules (both are required — verified on dgx01):
    // - `</dev/null` frees stdin so the launcher can't hold the SSH session.
    // - `;` before nohup (NOT `&&`): `A && B &` wraps the list in an implicit
    //   subshell whose unredirected stdio keeps the SSH session open until
    //   the launcher exits (start "times out" at 15s while the model actually
    //   loads fine). `A; B &` backgrounds the nohup command directly, ssh
    //   returns instantly, and $! is the real launcher PID.
    const cmd = `mkdir -p ${shq(START_LOG_DIR)}; nohup bash ${shq(svc.start)} ${svc.args} </dev/null > ${shq(logFile)} 2>&1 & echo "PID:$!"`;
    try {
      const out = await this.execFn(spark, cmd, { timeoutMs: 15_000 });
      const m = out.match(/PID:(\d+)/);
      state.status = "starting";
      // For script-kind services the launcher exits on its own once the
      // process is spawned (ComfyRT prints "is starting" after ~30s), so its
      // PID is meaningless for tracking — status.sh reports the real PID.
      state.pid = svc.kind === "script" ? null : m ? parseInt(m[1], 10) : null;
      state.startedAt = this.nowFn();
      state.readyAt = null;
      state.lastError = null;
      state.lastAction = "start";
      state.lastActionAt = state.startedAt;
      return { ok: true };
    } catch (err) {
      state.status = "failed";
      state.lastError = `start failed: ${err.message}`;
      state.lastAction = "start";
      state.lastActionAt = this.nowFn();
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Stop a service. Runs the stop shim synchronously (the LLMRT launcher
   * enforces its own 30s graceful-stop timeout). The next poll confirms.
   */
  async stop(sparkId, name) {
    const unit = this.units.get(sparkId);
    const spark = this.registry.getSpark(sparkId);
    if (!unit || !spark) return { ok: false, reason: "not configured" };
    const entry = this._svcEntry(sparkId, unit, name);
    if (!entry) return { ok: false, reason: "unknown service" };
    const { svc, state } = entry;

    if (!["starting", "loading", "ready"].includes(state.status)) {
      return { ok: false, reason: `${name} is not running (${state.status})` };
    }

    state.status = "stopping";
    state.lastAction = "stop";
    state.lastActionAt = this.nowFn();
    try {
      await this.execFn(spark, `bash ${shq(svc.stop)} ${svc.args}`, { timeoutMs: STOP_TIMEOUT_MS });
      return { ok: true };
    } catch (err) {
      state.status = "unknown";
      state.lastError = `stop failed: ${err.message}`;
      return { ok: false, reason: err.message };
    }
  }

  /**
   * Tail container logs for one service rank. The container name comes from
   * the last parsed status output; rank 0 = head (local docker on the unit),
   * rank 1 = worker (reached through the head's SSH hop, like LLMRT does).
   *
   * @returns {Promise<{ lines: string[], error?: string }>}
   */
  async logs(sparkId, name, rank = 0, count = 40) {
    const unit = this.units.get(sparkId);
    const spark = this.registry.getSpark(sparkId);
    if (!unit || !spark) return { lines: [], error: "not configured" };
    const svc = unit.services.find((s) => s.name === name);
    if (!svc) return { lines: [], error: "unknown service" };
    const lines = Math.max(1, Math.min(200, Number(count) || 40));
    const r = Math.max(0, Math.min(1, Number(rank) || 0));
    // script kind: plain log file tail (single node, rank ignored).
    if (svc.kind === "script") {
      if (!svc.logFile) return { lines: [], error: "no logFile configured" };
      try {
        const out = await this.execFn(spark, `tail -n ${lines} ${shq(svc.logFile)} 2>&1`, { timeoutMs: 15_000 });
        return { lines: out.split("\n").map(stripAnsi) };
      } catch (err) {
        return { lines: [], error: err.message };
      }
    }
    const container = (this.state.get(sparkId)?.get(name)?.ranks || []).find((x) => x.rank === r)?.container;
    if (!container || !CONTAINER_RE.test(container)) {
      return { lines: [], error: "no container reported yet — start the service first" };
    }
    // rank 1 runs on the worker node; hop via the head exactly like LLMRT does
    // (WORKER_SSH_TARGET lives in the deployment env on the head).
    const inner =
      r === 0
        ? `docker logs --tail ${lines} ${shq(container)} 2>&1`
        : `ssh -T -o BatchMode=yes "\${WORKER_SSH_TARGET:?worker target unset}" docker logs --tail ${lines} ${shq(container)} 2>&1`;
    try {
      const out = await this.execFn(spark, inner, { timeoutMs: 15_000 });
      return { lines: out.split("\n").map(stripAnsi) };
    } catch (err) {
      return { lines: [], error: err.message };
    }
  }

  /** Poll every configured unit once. In-flight guard prevents overlap. */
  async pollAll() {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const [sparkId, unit] of this.units) {
        const spark = this.registry.getSpark(sparkId);
        if (!spark) continue;
        await this.pollUnit(spark, unit, sparkId);
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * One status refresh for a unit: a single sshExec round trip runs every
   * service's `status.sh` (marker-separated) plus a start-PID liveness check,
   * then the API port is probed over HTTP.
   */
  async pollUnit(spark, unit, sparkId) {
    const svcMap = this.state.get(sparkId);
    if (!svcMap) return;
    const tracking = [...svcMap.entries()].find(([, s]) => s.status === "starting");
    const pidPart = tracking?.[1]?.pid
      ? `; echo ---MARK---; ps -p ${tracking[1].pid} > /dev/null 2>&1 && echo PID_ALIVE || echo PID_DEAD`
      : "";
    const statusCmds = unit.services
      .map((s) => `timeout 8 bash ${shq(s.status)} ${s.args}`)
      .join("; echo ---MARK---; ");
    let output = null;
    let execError = null;
    try {
      // `timeout 8` per script: during model load a launcher status can hang
      // in its API-health check (~2×4s per script); one slow script must not
      // poison the whole poll. Rank lines are printed before that check, so
      // partial output stays parseable. Trailing `; true` neutralizes exit
      // codes — only a transport failure may raise here.
      output = await this.execFn(spark, `${statusCmds}${pidPart}; true`, { timeoutMs: 35_000 });
    } catch (err) {
      execError = err.message;
    }

    // One probe per unique service port (ComfyUI may live on another port).
    const ports = [...new Set(unit.services.map((s) => s.port ?? unit.port))];
    const portResults = new Map();
    if (!execError) {
      for (const port of ports) {
        portResults.set(port, await this.probeFn(spark, port, unit.services.find((s) => (s.port ?? unit.port) === port)?.probePath ?? "/v1/models"));
      }
    }

    // One chunk per service, in config order; a trailing chunk (when present)
    // is the PID liveness result.
    const chunks = output == null ? unit.services.map(() => null) : output.split("---MARK---").map((c) => c.trim());

    for (let i = 0; i < unit.services.length; i++) {
      const svc = unit.services[i];
      const state = svcMap.get(svc.name);
      if (!state) continue;
      const chunk = chunks[i] != null ? chunks[i] : "";
      const ranks = svc.kind === "script" ? parseScriptStatus(chunk) : parseLauncherStatus(chunk);
      const port = svc.port ?? unit.port;
      const portUp = execError ? null : (portResults.get(port) ?? false);
      this._applyPoll(sparkId, svc.name, ranks, portUp, execError, tracking?.[1]);
    }
    // PID liveness (start phase only): dead launcher + port still closed is
    // a hard failure even before containers would have shown up.
    if (!execError && tracking) {
      const pidChunk = chunks[unit.services.length];
      if (pidChunk && /PID_DEAD/.test(pidChunk)) {
        const state = svcMap.get(tracking[0]);
        if (state && ["starting", "loading"].includes(state.status)) {
          state.status = "failed";
          state.pid = null;
          state.lastError = "launcher exited before the API came up — check logs";
        }
      }
    }
  }

  /**
   * Derive UI status from poll results + in-memory runtime. The remote
   * launcher remains the authority for mutations; this only paints the map.
   */
  _applyPoll(sparkId, name, ranks, portUp, execError, tracking) {
    const unit = this.units.get(sparkId);
    const entry = this._svcEntry(sparkId, unit, name);
    if (!entry) return;
    const { state } = entry;

    if (execError) {
      // SSH/network trouble: report unknown but keep timestamps.
      state.status = "unknown";
      state.ranks = ranks;
      state.lastError = `status poll failed: ${execError}`;
      return;
    }

    const anyRunning = ranks.some((r) => r.state === "running" || r.state === "restarting");
    state.ranks = ranks;
    const svc = unit.services.find((s) => s.name === name);
    const isScript = svc?.kind === "script";

    switch (state.status) {
      case "starting":
      case "loading": {
        if (portUp) {
          state.status = "ready";
          state.readyAt = this.nowFn();
          state.pid = null;
          state.lastError = null;
        } else if (anyRunning) {
          state.status = "loading";
        } else if (ranks.length > 0 && !anyRunning && !isScript) {
          // Containers already exited during startup → launcher failed.
          // (script kind: "stopped" status is normal before the process is
          // spawned — never a failure signal on its own.)
          state.status = "failed";
          state.pid = null;
          state.lastError = "containers exited during startup — check logs";
        } else if (state.status === "loading" && !anyRunning) {
          // Was loading with a live process, now none reported: crashed.
          state.status = "failed";
          state.lastError = "process exited before the service became ready — check logs";
        }
        // else: still in pre-flight (image checks, NFS, spawn) — keep starting.
        break;
      }
      case "stopping": {
        if (!anyRunning) {
          state.status = "stopped";
          state.pid = null;
          state.startedAt = null;
          state.readyAt = null;
          state.lastError = null;
        }
        break;
      }
      default: {
        // Idle tracking (stopped/failed/ready/unknown): derive from reality so
        // externally started/stopped services are reflected.
        if (anyRunning) {
          const next = portUp ? "ready" : "loading";
          if (state.status !== next) {
            if (next === "ready" && !state.readyAt) state.readyAt = this.nowFn();
            if (next === "loading" && !state.startedAt) state.startedAt = this.nowFn();
          }
          state.status = next;
          if (next === "ready") state.lastError = null;
        } else {
          if (state.status === "ready" || state.status === "loading") {
            state.lastError = "containers exited unexpectedly — check logs";
          }
          state.status = "stopped";
          state.startedAt = null;
          state.readyAt = null;
        }
        // A tracked start that already resolved elsewhere should not linger.
        if (tracking?.[0] === name && tracking[1]?.pid && state.status !== "starting") {
          tracking[1].pid = null;
        }
      }
    }
  }
}
