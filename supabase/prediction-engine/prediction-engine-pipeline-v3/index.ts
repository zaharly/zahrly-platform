import { GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_BUCKET = Deno.env.get("S3_BUCKET") ?? Deno.env.get("AWS_S3_BUCKET") ?? "zahrly-community-storage";
const REGION = Deno.env.get("S3_REGION") ?? Deno.env.get("AWS_REGION") ?? "eu-central-1";
const MAX_FIXTURES = 25;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
}

function getS3Credentials() {
  const accessKeyId = Deno.env.get("S3_ACCESS_KEY_ID") ?? Deno.env.get("AWS_ACCESS_KEY_ID") ?? Deno.env.get("AWS_ACCESS_KEY");
  const secretAccessKey = Deno.env.get("S3_SECRET_ACCESS_KEY") ?? Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? Deno.env.get("AWS_SECRET_KEY");
  if (!accessKeyId || !secretAccessKey) throw new Error("s3_credentials_missing");
  return { accessKeyId, secretAccessKey };
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function poisson(goals: number, lambda: number) {
  let factorial = 1;
  for (let i = 2; i <= goals; i++) factorial *= i;
  return Math.exp(goals * Math.log(lambda) - lambda) / factorial;
}

function tau(h: number, a: number, rho: number, lh: number, la: number) {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

function probabilities(lh: number, la: number, rho: number, maxGoals: number) {
  let total = 0, home = 0, draw = 0, away = 0;
  for (let h = 0; h <= maxGoals; h++) for (let a = 0; a <= maxGoals; a++) {
    const p = poisson(h, lh) * poisson(a, la) * Math.max(0, tau(h, a, rho, lh, la));
    total += p;
    if (h > a) home += p; else if (h === a) draw += p; else away += p;
  }
  if (!(total > 0)) throw new Error("invalid_probability_mass");
  return { home: home / total, draw: draw / total, away: away / total };
}

async function readModelArtifact(model: any) {
  const match = String(model.artifact_uri ?? "").match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error("invalid_model_artifact_uri");
  const [, bucket, key] = match;
  const s3 = new S3Client({ region: REGION, credentials: getS3Credentials() });
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket || DEFAULT_BUCKET, Key: key }));
  const text = await object.Body?.transformToString("utf-8");
  if (!text) throw new Error("empty_model_artifact");
  const actualHash = await sha256(text);
  const artifact = JSON.parse(text);
  const declaredHash = artifact?.metrics?.artifact_sha256 ?? artifact?.artifact_sha256 ?? null;
  if (declaredHash && declaredHash !== actualHash) throw new Error(`model_artifact_checksum_mismatch:${actualHash}`);
  if (artifact?.model_version_id && artifact.model_version_id !== model.id) throw new Error("model_artifact_version_mismatch");
  return { artifact, actualHash };
}

async function selectRelease(mode: "shadow" | "production") {
  let query = db.from("model_releases").select("model_version_id,release_version,status,approval_state,reason,created_at").order("created_at", { ascending: false }).limit(20);
  query = mode === "production" ? query.eq("status", "ACTIVE").eq("approval_state", "APPROVED") : query.eq("status", "SHADOW");
  const { data: releases, error } = await query;
  if (error) throw error;
  for (const release of releases ?? []) {
    const { data: model, error: modelError } = await db.from("model_versions").select("id,version,status,artifact_uri,training_cutoff").eq("id", release.model_version_id).single();
    if (!modelError && model?.artifact_uri) return { release, model };
  }
  throw new Error(mode === "production" ? "production_model_not_approved" : "no_shadow_model_artifact_available");
}

async function gate(modelId: string) {
  const { data, error } = await db.from("prediction_training_runs").select("id,status,metrics,started_at").eq("model_version_id", modelId).order("started_at", { ascending: false }).limit(1);
  if (error) throw error;
  const run = data?.[0];
  const result = run?.metrics?.benchmark_gate ?? null;
  return { training_run_id: run?.id ?? null, training_status: run?.status ?? null, gate_status: result?.status ?? "UNKNOWN", promotion_eligible: result?.promotion_eligible === true };
}

async function ensurePolicy() {
  const { data: existing, error } = await db.from("policy_versions").select("id,version,payload").eq("policy_type", "prediction").eq("version", "prediction-v1").maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const payload = { schema_version: "prediction-policy-v1", default_mode: "shadow", activation_requires: ["ACTIVE", "APPROVED", "promotion_eligible=true"], markets: ["1x2_home", "1x2_draw", "1x2_away"] };
  const { data, error: insertError } = await db.from("policy_versions").insert({ policy_type: "prediction", version: "prediction-v1", payload }).select("id,version,payload").single();
  if (insertError) throw insertError;
  return data;
}

async function ensureMarkets() {
  const markets = [
    { market_key: "1x2_home", family: "1X2", settlement_type: "HOME_WIN", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
    { market_key: "1x2_draw", family: "1X2", settlement_type: "DRAW", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
    { market_key: "1x2_away", family: "1X2", settlement_type: "AWAY_WIN", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
  ];
  const { error } = await db.from("market_registry").upsert(markets, { onConflict: "market_key" });
  if (error) throw error;
  const semantics = markets.map((m) => ({ market_key: m.market_key, provider_key: `internal:${m.market_key}`, line_semantics: null, settlement_rules: { result: m.settlement_type }, valid_from: new Date().toISOString(), verification_status: "VERIFIED", schema_version: "prediction-v1" }));
  const { error: semanticsError } = await db.from("market_semantics_registry").upsert(semantics, { onConflict: "id" });
  if (semanticsError && !String(semanticsError.message).toLowerCase().includes("unique")) throw semanticsError;
}

function predict(fixture: any, artifact: any) {
  const elo = artifact.elo ?? {}, dc = artifact.dixon_coles ?? {}, ratings = elo.ratings ?? {};
  const rating = (team: string) => Number(ratings[team]?.rating ?? ratings[team] ?? elo.initial_rating ?? 1500);
  const rh = rating(fixture.home_team_id), ra = rating(fixture.away_team_id);
  const edge = 1 / (1 + Math.exp(-((rh + Number(elo.home_advantage ?? 60)) - ra) / Number(elo.rating_scale ?? 400) * 2.302585092994046));
  const attack = dc.attack ?? {}, defense = dc.defense ?? {};
  const rate = Math.max(Number(dc.league_rate ?? 1.2), 0.05);
  const ha = Number(attack[fixture.home_team_id] ?? 1), aa = Number(attack[fixture.away_team_id] ?? 1);
  const hd = Number(defense[fixture.home_team_id] ?? 1), ad = Number(defense[fixture.away_team_id] ?? 1);
  const lh = Math.max(0.05, rate * Math.exp(Number(dc.home_advantage ?? 0.15)) * ha / Math.max(ad, 0.05) * (0.75 + 0.5 * edge));
  const la = Math.max(0.05, rate * aa / Math.max(hd, 0.05) * (1.25 - 0.5 * edge));
  return { probabilities: probabilities(lh, la, Number(dc.rho ?? -0.10), Math.min(Math.max(Number(dc.max_goals ?? 10), 1), 12)), lambdas: { home: lh, away: la } };
}

async function persistFixture(fixture: any, episode: any, model: any, policy: any, artifact: any, artifactSha: string, mode: "shadow" | "production") {
  const idempotencyKey = `prediction:${fixture.id}:${episode.id}:${model.id}`;
  const { data: existingJob, error: existingJobError } = await db.from("prediction_jobs").select("job_id,status").eq("fixture_id", fixture.id).eq("episode_id", episode.id).eq("model_version_id", model.id).maybeSingle();
  if (existingJobError) throw existingJobError;
  if (existingJob?.status === "SUCCEEDED") return { fixture_id: fixture.id, status: "ALREADY_SUCCEEDED", prediction_job_id: existingJob.job_id };

  const prediction = predict(fixture, artifact);
  const pick = prediction.probabilities.home >= Math.max(prediction.probabilities.draw, prediction.probabilities.away) ? "H" : prediction.probabilities.draw >= prediction.probabilities.away ? "D" : "A";
  const baselinePayload = { episode_id: episode.id, fixture_id: fixture.id, model_version_id: model.id, policy_bundle_id: policy.id, artifact_sha256: artifactSha, probabilities: prediction.probabilities, lambdas: prediction.lambdas, training_cutoff: model.training_cutoff ?? null };
  const baselineHash = await sha256(JSON.stringify(baselinePayload));

  const { data: priorBaseline, error: baselineFindError } = await db.from("prediction_baselines").select("id,model_version_id,baseline_hash,policy_bundle_id,baseline_pick,baseline_probability").eq("episode_id", episode.id).maybeSingle();
  if (baselineFindError) throw baselineFindError;
  if (priorBaseline && (priorBaseline.model_version_id !== model.id || priorBaseline.baseline_hash !== baselineHash)) {
    throw new Error(`baseline_immutable_conflict:episode=${episode.id}`);
  }

  let baseline = priorBaseline;
  if (!baseline) {
    if (mode !== "production") return { fixture_id: fixture.id, status: "SHADOW_PREVIEW", prediction: prediction.probabilities, baseline_hash: baselineHash };
    const { data, error } = await db.from("prediction_baselines").insert({ episode_id: episode.id, model_version_id: model.id, policy_bundle_id: policy.id, baseline_pick: pick, baseline_probability: Math.max(prediction.probabilities.home, prediction.probabilities.draw, prediction.probabilities.away), baseline_hash: baselineHash }).select("id,model_version_id,baseline_hash,policy_bundle_id,baseline_pick,baseline_probability").single();
    if (error) throw error;
    baseline = data;
  }

  if (mode !== "production") return { fixture_id: fixture.id, status: "SHADOW_READY", prediction: prediction.probabilities, baseline_id: baseline.id, baseline_hash: baselineHash };

  const evidenceHash = await sha256(JSON.stringify({ baseline_id: baseline.id, model_version_id: model.id, probabilities: prediction.probabilities, artifact_sha256: artifactSha }));
  const { data: existingEvidence, error: evidenceFindError } = await db.from("prediction_evidence_updates").select("id").eq("baseline_id", baseline.id).eq("evidence_type", "MODEL_BASELINE").maybeSingle();
  if (evidenceFindError) throw evidenceFindError;
  if (!existingEvidence) {
    const { error } = await db.from("prediction_evidence_updates").insert({ baseline_id: baseline.id, evidence_type: "MODEL_BASELINE", current_probability: baseline.baseline_probability, model_version_id: model.id, evidence_snapshot_hash: evidenceHash });
    if (error) throw error;
  }

  const states = [
    { market_key: "1x2_home", probability: prediction.probabilities.home },
    { market_key: "1x2_draw", probability: prediction.probabilities.draw },
    { market_key: "1x2_away", probability: prediction.probabilities.away },
  ];
  for (const state of states) {
    const { data: current, error: currentError } = await db.from("prediction_market_states").select("id,baseline_id,probability,status").eq("episode_id", episode.id).eq("market_key", state.market_key).maybeSingle();
    if (currentError) throw currentError;
    if (!current) {
      const { error } = await db.from("prediction_market_states").insert({ baseline_id: baseline.id, episode_id: episode.id, market_key: state.market_key, probability: state.probability, fair_odds: state.probability > 0 ? 1 / state.probability : null, status: "PRODUCTION_ENABLED" });
      if (error) throw error;
    } else if (current.baseline_id !== baseline.id) {
      throw new Error(`market_state_immutable_conflict:episode=${episode.id}:market=${state.market_key}`);
    }
  }

  const payload = { fixture_id: fixture.id, episode_id: episode.id, model_version_id: model.id, baseline_id: baseline.id, probabilities: prediction.probabilities, lambdas: prediction.lambdas, status: "PUBLISHED", published_at: new Date().toISOString() };
  const { data: currentReadModel, error: readFindError } = await db.from("prediction_read_models").select("version,payload").eq("fixture_id", fixture.id).eq("episode_id", episode.id).maybeSingle();
  if (readFindError) throw readFindError;
  const nextVersion = Number(currentReadModel?.version ?? 0) + 1;
  const { error: readError } = await db.from("prediction_read_models").upsert({ fixture_id: fixture.id, episode_id: episode.id, payload, version: nextVersion, published_at: new Date().toISOString() }, { onConflict: "fixture_id,episode_id" });
  if (readError) throw readError;

  return { fixture_id: fixture.id, status: "SUCCEEDED", baseline_id: baseline.id, read_model_published: true };
}

async function run(mode: "shadow" | "production") {
  const { release, model } = await selectRelease(mode);
  const training = await gate(model.id);
  if (mode === "production" && !training.promotion_eligible) throw new Error(`production_activation_blocked:${training.gate_status}`);
  const policy = await ensurePolicy();
  await ensureMarkets();
  const { artifact, actualHash } = await readModelArtifact(model);

  const { data: fixtures, error } = await db.from("fixtures").select("id,home_team_id,away_team_id,kickoff_at,status").eq("status", "scheduled").gte("kickoff_at", new Date().toISOString()).order("kickoff_at", { ascending: true }).limit(MAX_FIXTURES);
  if (error) throw error;

  const results = [];
  for (const fixture of fixtures ?? []) {
    const { data: episode, error: episodeError } = await db.from("fixture_episodes").select("id,fixture_id,episode_no,kickoff_at,episode_status").eq("fixture_id", fixture.id).order("episode_no", { ascending: false }).limit(1).maybeSingle();
    if (episodeError) throw episodeError;
    if (!episode) {
      results.push({ fixture_id: fixture.id, status: "ABSTAINED", reason: "no_prediction_episode" });
      continue;
    }

    if (mode === "production") {
      const { data: workerExisting, error: workerFindError } = await db.from("worker_jobs").select("job_id,status").eq("idempotency_key", `prediction:${fixture.id}:${episode.id}:${model.id}`).maybeSingle();
      if (workerFindError) throw workerFindError;
      if (workerExisting?.status === "SUCCEEDED") {
        results.push({ fixture_id: fixture.id, status: "ALREADY_SUCCEEDED", worker_job_id: workerExisting.job_id });
        continue;
      }
      const { data: worker, error: workerError } = await db.from("worker_jobs").insert({ queue_name: "PREDICTION_QUEUE", idempotency_key: `prediction:${fixture.id}:${episode.id}:${model.id}`, status: "RUNNING", attempts: 1, started_at: new Date().toISOString() }).select("job_id").single();
      if (workerError) throw workerError;
      const { data: predictionJob, error: predictionJobError } = await db.from("prediction_jobs").insert({ fixture_id: fixture.id, episode_id: episode.id, model_version_id: model.id, policy_bundle_id: policy.id, status: "RUNNING", started_at: new Date().toISOString(), worker_job_id: worker.job_id }).select("job_id").single();
      if (predictionJobError) throw predictionJobError;
      try {
        const result = await persistFixture(fixture, episode, model, policy, artifact, actualHash, mode);
        await db.from("prediction_jobs").update({ status: "SUCCEEDED", finished_at: new Date().toISOString() }).eq("job_id", predictionJob.job_id);
        await db.from("worker_jobs").update({ status: "SUCCEEDED", finished_at: new Date().toISOString() }).eq("job_id", worker.job_id);
        results.push({ ...result, prediction_job_id: predictionJob.job_id, worker_job_id: worker.job_id });
      } catch (error) {
        const message = String(error).slice(0, 1000);
        await db.from("prediction_jobs").update({ status: "FAILED", finished_at: new Date().toISOString(), error_code: "PREDICTION_EXECUTION_FAILED", error_message: message }).eq("job_id", predictionJob.job_id);
        await db.from("worker_jobs").update({ status: "FAILED", finished_at: new Date().toISOString(), error_code: "PREDICTION_EXECUTION_FAILED", error_message: message }).eq("job_id", worker.job_id);
        results.push({ fixture_id: fixture.id, status: "FAILED", error: message });
      }
    } else {
      results.push(await persistFixture(fixture, episode, model, policy, artifact, actualHash, mode));
    }
  }

  return { ok: true, mode, model: { id: model.id, version: model.version, release_version: release.release_version, artifact_sha256: actualHash }, training, policy_bundle_id: policy.id, fixtures_considered: results.length, results, production_writes_enabled: mode === "production" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ ok: false, error: "POST required" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === "production" ? "production" : "shadow";
    if (mode === "production" && body?.confirm_activation !== true) return response({ ok: false, error: "production_requires_confirm_activation" }, 400);
    return response(await run(mode));
  } catch (error) {
    return response({ ok: false, error: String(error) }, 409);
  }
});
