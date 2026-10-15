/**
 * Unit tests for GLM Atlas engine detection and metrics (atlas_* series).
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { LlmProbe } from "../LlmProbe.js";

// Realistic atlas /metrics exposition (GLM Atlas engine). +Inf == _count.
const ATLAS_METRICS = `# HELP atlas_decoded_tokens_total Tokens decoded, counted as they are produced (rate-friendly)
# TYPE atlas_decoded_tokens_total counter
atlas_decoded_tokens_total 60230
# HELP atlas_generation_tokens_total Total tokens generated
# TYPE atlas_generation_tokens_total counter
atlas_generation_tokens_total 60230
# HELP atlas_prompt_tokens_total Total prompt tokens processed
# TYPE atlas_prompt_tokens_total counter
atlas_prompt_tokens_total 16032132
# HELP atlas_requests_active Currently active requests
# TYPE atlas_requests_active gauge
atlas_requests_active 2
# HELP atlas_time_to_first_token_seconds Time to first token
# TYPE atlas_time_to_first_token_seconds histogram
atlas_time_to_first_token_seconds_bucket{model="glm-5.3-flash-nvfp4-atlas",le="0.5"} 1
atlas_time_to_first_token_seconds_bucket{model="glm-5.3-flash-nvfp4-atlas",le="1"} 77
atlas_time_to_first_token_seconds_bucket{model="glm-5.3-flash-nvfp4-atlas",le="2.5"} 179
atlas_time_to_first_token_seconds_bucket{model="glm-5.3-flash-nvfp4-atlas",le="5"} 180
atlas_time_to_first_token_seconds_bucket{model="glm-5.3-flash-nvfp4-atlas",le="+Inf"} 180
atlas_time_to_first_token_seconds_sum{model="glm-5.3-flash-nvfp4-atlas"} 207.545891738
atlas_time_to_first_token_seconds_count{model="glm-5.3-flash-nvfp4-atlas"} 180
# HELP atlas_prefix_cache_hits_total Prefix cache lookups that found cached blocks
# TYPE atlas_prefix_cache_hits_total counter
atlas_prefix_cache_hits_total 178
# HELP atlas_prefix_cache_misses_total Prefix cache lookups with no match
# TYPE atlas_prefix_cache_misses_total counter
atlas_prefix_cache_misses_total 2
# HELP atlas_prefix_cache_hit_tokens_total Tokens reused from prefix cache
# TYPE atlas_prefix_cache_hit_tokens_total counter
atlas_prefix_cache_hit_tokens_total 15878080
# HELP atlas_prefix_cache_hit_rate Prefix cache hit rate (0-1)
# TYPE atlas_prefix_cache_hit_rate gauge
atlas_prefix_cache_hit_rate 0.9889
`;

test("_metricsLookLikeAtlas: true for atlas exposition", () => {
  assert.equal(LlmProbe._metricsLookLikeAtlas(ATLAS_METRICS), true);
});

test("_metricsLookLikeAtlas: false for vLLM exposition", () => {
  assert.equal(
    LlmProbe._metricsLookLikeAtlas("vllm:generation_tokens_total 10.0\n"),
    false
  );
});

test("_applyAtlasMetrics: counters seed totals, gauges and histogram parse", () => {
  const probe = new LlmProbe({ lanIp: "127.0.0.1" }, 8001);
  // First sample seeds counters (no rate yet — needs a prior baseline)
  probe._applyAtlasMetrics(ATLAS_METRICS, 2);
  assert.equal(probe.totalOutputTokens, 60230);
  assert.equal(probe.totalPromptTokens, 16032132);
  assert.equal(probe.totalCachedTokens, 15878080);
  assert.equal(probe.requestsRunning, 2);
  assert.equal(probe.slotsActive, 2);
  // Histogram parsed: 179/180 observations ≤ 2.5s → p95 in (1, 2.5]
  assert.ok(
    probe.ttftP95Seconds != null && probe.ttftP95Seconds > 1 && probe.ttftP95Seconds <= 2.5,
    `ttft p95=${probe.ttftP95Seconds}`
  );
  assert.equal(probe.prefixCacheHitRate, 0.9889);
  // vLLM-specific tiles stay empty
  assert.equal(probe.kvCacheUsage, null);
  assert.equal(probe.requestsWaiting, null);

  // Second sample: +300 decoded tokens, +5000 prompt tokens (1000 cached) over 2s
  const next = ATLAS_METRICS
    .replace("atlas_decoded_tokens_total 60230", "atlas_decoded_tokens_total 60530")
    .replace("atlas_generation_tokens_total 60230", "atlas_generation_tokens_total 60530")
    .replace("atlas_prompt_tokens_total 16032132", "atlas_prompt_tokens_total 16037132")
    .replace("atlas_prefix_cache_hit_tokens_total 15878080", "atlas_prefix_cache_hit_tokens_total 15879080");
  probe._applyAtlasMetrics(next, 2);
  assert.equal(probe.generationTps, 150); // 300 / 2s
  // Prefill counts computed tokens only: (5000 - 1000) / 2s
  assert.equal(probe.prefillTps, 2000);
});

test("_applyAtlasMetrics: idle (unchanged counters) → 0 tok/s", () => {
  const probe = new LlmProbe({ lanIp: "127.0.0.1" }, 8001);
  probe._applyAtlasMetrics(ATLAS_METRICS, 2);
  probe._applyAtlasMetrics(ATLAS_METRICS, 2);
  assert.equal(probe.generationTps, 0);
  assert.equal(probe.prefillTps, 0);
});
