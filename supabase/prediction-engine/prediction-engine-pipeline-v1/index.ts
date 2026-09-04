import { GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = Deno.env.get("S3_BUCKET") ?? Deno.env.get("AWS_S3_BUCKET") ?? "zahrly-community-storage";
const REGION = Deno.env.get("S3_REGION") ?? Deno.env.get("AWS_REGION") ?? "eu-central-1";
const MAX_FIXTURES = 25;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function envAny(names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  return null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

function poissonPmf(goals: number, lambda: number) {
  let factorial = 1;
  for (let i = 2; i <= goals; i++) factorial *= i;
  return Math.exp(goals * Math.log(lambda) - lambda) / factorial;
}

function dcTau(h: number, a: number, rho: number, lh: number, la: number) {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

function resultProbabilities(homeLambda: number, awayLambda: number, rho: number, maxGoals: number) {
  const matrix: number[][] = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const p = poissonPmf(h, homeLambda) * poissonPmf(a, awayLambda) * Math.max(0, dcTau(h, a, rho, homeLambda, awayLambda));
      row.push(p);
      total += p;
    }
    matrix.push(row);
  }
  if (!(total > 0)) throw new Error("invalid_probability_mass");
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = matrix[h][a] / total;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }
  return [home, draw, away];
}

async function loadArtifact(artifactUri: string, expectedHash: string | null) {
  const parsed = artifactUri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!parsed) throw new Error("invalid_model_artifact_uri");
  const [_, bucket, key] = parsed;
  const accessKeyId = envAny(["S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY"]);
  const secretAccessKey = envAny(["S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY", "AWS_SECRET_KEY"]);
  if (!accessKeyId || !secretAccessKey) throw new Error("s3_credentials_missing");
  const s3 = new S3Client({ region: REGION, credentials: { accessKeyId, secretAccessKey } });
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket || BUCKET, Key: key }));
  const text = await response.Body?.transformToString("utf-8");
  if (!text) throw new Error("empty_model_artifact");
  const actualHash = sha256(text);
  if (expectedHash && actualHash !== expectedHash) throw new Error(`model_artifact_checksum_mismatch:${actualHash}`);
  return JSON.parse(text);
}

async function selectedModel(mode: "shadow" | "production") {
  const query = supabase
    .from("model_releases")
    .select("model_version_id,release_version,status,approval_state,reason,created_at,model_versions:public_model_version_id")
    .limit(1);

  if (mode === "production") {
    const { data, error } = await query.eq("status", "ACTIVE").eq("approval_state", "APPROVED").order("created_at", { ascending: false });
    if (error || !data?.length) throw new Error("production_model_not_approved");
    const modelVersionId = data[0].model_version_id;
    const { data: model, error: modelError } = await supabase.from("model_versions").select("id,version,status,artifact_uri,training_cutoff").eq("id", modelVersionId).single();
    if (modelError || !model || model.status !== "ACTIVE" || !model.artifact_uri) throw new Error("production_model_artifact_unavailable");
    return { release: data[0], model };
  }

  const { data: releases, error } = await supabase
    .from("model_releases")
    .select("model_version_id,release_version,status,approval_state,reason,created_at")
    .eq("status", "SHADOW")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  for (const release of releases ?? []) {
    const { data: model } = await supabase.from("model_versions").select("id,version,status,artifact_uri,training_cutoff").eq("id", release.model_version_id).single();
    if (model?.artifact_uri) return { release, model };
  }
  throw new Error("no_shadow_model_artifact_available");
}

async function ensurePredictionPolicy() {
  const payload = {
    schema_version: "prediction-policy-v1",
    default_mode: "shadow",
    max_fixtures_per_run: MAX_FIXTURES,
    activation_requires: ["model_release=ACTIVE", "approval_state=APPROVED", "promotion_gate=true"],
    markets: ["1x2_home", "1x2_draw", "1x2_away"],
  };
  const { data: existing, error: findError } = await supabase
    .from("policy_versions")
    .select("id,policy_type,version,payload")
    .eq("policy_type", "prediction")
    .eq("version", "prediction-v1")
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;
  const { data, error } = await supabase
    .from("policy_versions")
    .insert({ policy_type: "prediction", version: "prediction-v1", payload })
    .select("id,policy_type,version,payload")
    .single();
  if (error) throw error;
  return data;
}

async function ensureMarkets() {
  const markets = [
    { market_key: "1x2_home", family: "1X2", settlement_type: "HOME_WIN", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
    { market_key: "1x2_draw", family: "1X2", settlement_type: "DRAW", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
    { market_key: "1x2_away", family: "1X2", settlement_type: "AWAY_WIN", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
  ];
  const { error } = await supabase.from("market_registry").upsert(markets, { onConflict: "market_key" });
  if (error) throw error;
  return markets.map((m) => m.market_key);
}

async function gateStatus(modelVersionId: string) {
  const { data, error } = await supabase
    .from("prediction_training_runs")
    .select("id,status,metrics,started_at")
    .eq("model_version_id", modelVersionId)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const gate = data?.[0]?.metrics?.benchmark_gate;
  return { training_run_id: data?.[0]?.id ?? null, training_status: data?.[0]?.status ?? null, promotion_eligible: gate?.promotion_eligible === true, gate_status: gate?.status ?? "UNKNOWN" };
}

async function executePrediction(fixture: any, episode: any, model: any, policy: any, mode: "shadow" | "production") {
  const modelArtifact = await loadArtifact(model.artifact_uri, model.metadata?.artifact_sha256 ?? null);
  const elo = modelArtifact.elo ?? {};
  const dc = modelArtifact.dixon_coles ?? {};
  const homeRating = Number(elo.ratings?.[fixture.home_team_id]?.rating ?? elo.ratings?.[fixture.home_team_id] ?? elo.initial_rating ?? 1500);
  const awayRating = Number(elo.ratings?.[fixture.away_team_id]?.rating ?? elo.ratings?.[fixture.away_team_id] ?? elo.initial_rating ?? 1500);
  const scale = Number(elo.rating_scale ?? 400);
  const homeAdvantage = Number(elo.home_advantage ?? 60);
  const ratingEdge = 1 / (1 + Math.exp(-((homeRating + homeAdvantage) - awayRating) / scale * 2.302585092994046));
  const attack = dc.attack ?? {};
  const defense = dc.defense ?? {};
  const rate = Math.max(Number(dc.league_rate ?? 1.2), 0.05);
  const dcHomeAdvantage = Number(dc.home_advantage ?? 0.15);
  const rho = Number(dc.rho ?? -0.10);
  const maxGoals = Math.min(Math.max(Number(dc.max_goals ?? 10), 1), 12);
  const ha = Number(attack[fixture.home_team_id] ?? 1);
  const aa = Number(attack[fixture.away_team_id] ?? 1);
  const hd = Number(defense[fixture.home_team_id] ?? 1);
  const ad = Number(defense[fixture.away_team_id] ?? 1);
  const lambdaHome = Math.max(0.05, rate * Math.exp(dcHomeAdvantage) * ha / Math.max(ad, 0.05) * (0.75 + 0.5 * ratingEdge));
  const lambdaAway = Math.max(0.05, rate * aa / Math.max(hd, 0.05) * (1.25 - 0.5 * ratingEdge));
  const [pHome, pDraw, pAway] = resultProbabilities(lambdaHome, lambdaAway, rho, maxGoals);
  const probabilities = { home: pHome, draw: pDraw, away: pAway };
  const baselinePayload = { episode_id: episode.id, fixture_id: fixture.id, model_version_id: model.id, policy_bundle_id: policy.id, probabilities, lambda_home: lambdaHome, lambda_away: lambdaAway, training_cutoff: model.training_cutoff ?? null };
  const baselineHash = sha256(JSON.stringify(baselinePayload));

  const { data: existingBaseline } = await supabase.from("prediction_baselines").select("id,baseline_hash").eq("episode_id", episode.id).maybeSingle();
  const baseline = existingBaseline ?? (await supabase.from("prediction_baselines").insert({ episode_id: episode.id, model_version_id: model.id, policy_bundle_id: policy.id, baseline_pick: ["H", "D", "A"][probabilities.home >= Math.max(probabilities.draw, probabilities.away) ? 0 : probabilities.draw >= probabilities.away ? 1 : 2], baseline_probability: Math.max(pHome, pDraw, pAway), baseline_hash: baselineHash }).select("id,baseline_hash").single()).data;
  if (!baseline) throw new Error("baseline_persistence_failed");

  const evidenceHash = sha256(JSON.stringify({ baseline_id: baseline.id, model_version_id: model.id, probabilities, policy: policy.version }));
  const { error: evidenceError } = await supabase.from("prediction_evidence_updates").insert({ baseline_id: baseline.id, evidence_type: "MODEL_BASELINE", current_probability: Math.max(pHome, pDraw, pAway), model_version_id: model.id, evidence_snapshot_hash: evidenceHash });
  if (evidenceError && !String(evidenceError.message).toLowerCase().includes("duplicate")) throw evidenceError;

  const marketStates = [
    { market_key: "1x2_home", probability: pHome, fair_odds: pHome > 0 ? 1 / pHome : null },
    { market_key: "1x2_draw", probability: pDraw, fair_odds: pDraw > 0 ? 1 / pDraw : null },
    { market_key: "1x2_away", probability: pAway, fair_odds: pAway > 0 ? 1 / pAway : null },
  ];
  for (const state of marketStates) {
    const { data: prior } = await supabase.from("prediction_market_states").select("id").eq("episode_id", episode.id).eq("market_key", state.market_key).maybeSingle();
    if (!prior) {
      const { error } = await supabase.from("prediction_market_states").insert({ baseline_id: baseline.id, episode_id: episode.id, market_key: state.market_key, probability: state.probability, fair_odds: state.fair_odds, status: mode === "production" ? "PRODUCTION_ENABLED" : "EXPERIMENTAL" });
      if (error) throw error;
    }
  }

  if (mode === "production") {
    const payload = { fixture_id: fixture.id, episode_id: episode.id, model_version_id: model.id, baseline_id: baseline.id, probabilities, markets: marketStates, status: "PUBLISHED", published_at: new Date().toISOString() };
    const { data: current } = await supabase.from("prediction_read_models").select("version").eq("fixture_id", fixture.id).eq("episode_id", episode.id).maybeSingle();
    const version = Number(current?.version ?? 0) + 1;
    const { error } = await supabase.from("prediction_read_models").upsert({ fixture_id: fixture.id, episode_id: episode.id, payload, version, published_at: new Date().toISOString() }, { onConflict: "fixture_id,episode_id" });
    if (error) throw error;
  }
  return { probabilities, baseline_id: baseline.id, market_states: marketStates.length, read_model_published: mode === "production" };
}

async function main(mode: "shadow" | "production") {
  const gate = { mode, checked_at: new Date().toISOString() } as Record<string, unknown>;
  const { release, model } = await selectedModel(mode);
  gate.model_version_id = model.id;
  gate.model_version = model.version;
  gate.release_status = release.status;
  gate.approval_state = release.approval_state;
  gate.training = await gateStatus(model.id);
  if (mode === "production" && !(gate.training as any).promotion_eligible) throw new Error(`production_activation_blocked:${(gate.training as any).gate_status}`);

  const policy = await ensurePredictionPolicy();
  await ensureMarkets();

  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id,home_team_id,away_team_id,kickoff_at,status")
    .eq("status", "scheduled")
    .gte("kickoff_at", new Date().toISOString())
    .order("kickoff_at", { ascending: true })
    .limit(MAX_FIXTURES);
  if (fixturesError) throw fixturesError;

  const results: unknown[] = [];
  for (const fixture of fixtures ?? []) {
    const { data: episode, error: episodeError } = await supabase.from("fixture_episodes").select("id,fixture_id,episode_no,kickoff_at,episode_status").eq("fixture_id", fixture.id).order("episode_no", { ascending: false }).limit(1).maybeSingle();
    if (episodeError) throw episodeError;
    if (!episode) {
      results.push({ fixture_id: fixture.id, status: "ABSTAINED", reason: "no_prediction_episode" });
      continue;
    }
    const idempotencyKey = `prediction:${fixture.id}:${episode.id}:${model.id}`;
    const { data: workerExisting } = await supabase.from("worker_jobs").select("job_id,status").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (workerExisting?.status === "SUCCEEDED") {
      results.push({ fixture_id: fixture.id, status: "ALREADY_SUCCEEDED", worker_job_id: workerExisting.job_id });
      continue;
    }
    const workerInsert = await supabase.from("worker_jobs").insert({ queue_name: "PREDICTION_QUEUE", idempotency_key: idempotencyKey, status: "RUNNING", attempts: 1, started_at: new Date().toISOString() }).select("job_id").single();
    if (workerInsert.error) throw workerInsert.error;
    const workerJobId = workerInsert.data.job_id;
    const predictionInsert = await supabase.from("prediction_jobs").insert({ fixture_id: fixture.id, episode_id: episode.id, model_version_id: model.id, policy_bundle_id: policy.id, status: "RUNNING", started_at: new Date().toISOString(), worker_job_id: workerJobId }).select("job_id").single();
    if (predictionInsert.error) throw predictionInsert.error;
    try {
      const execution = await executePrediction(fixture, episode, model, policy, mode);
      await supabase.from("prediction_jobs").update({ status: "SUCCEEDED", finished_at: new Date().toISOString(), error_code: null, error_message: null }).eq("job_id", predictionInsert.data.job_id);
      await supabase.from("worker_jobs").update({ status: "SUCCEEDED", finished_at: new Date().toISOString(), error_code: null, error_message: null }).eq("job_id", workerJobId);
      results.push({ fixture_id: fixture.id, prediction_job_id: predictionInsert.data.job_id, worker_job_id: workerJobId, status: "SUCCEEDED", ...execution });
    } catch (error) {
      const message = String(error);
      await supabase.from("prediction_jobs").update({ status: "FAILED", finished_at: new Date().toISOString(), error_code: "PREDICTION_EXECUTION_FAILED", error_message: message.slice(0, 1000) }).eq("job_id", predictionInsert.data.job_id);
      await supabase.from("worker_jobs").update({ status: "FAILED", finished_at: new Date().toISOString(), error_code: "PREDICTION_EXECUTION_FAILED", error_message: message.slice(0, 1000) }).eq("job_id", workerJobId);
      results.push({ fixture_id: fixture.id, prediction_job_id: predictionInsert.data.job_id, status: "FAILED", error: message });
    }
  }

  return { ok: true, ...gate, processed: results.length, results, production_read_models_written: mode === "production" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === "production" ? "production" : "shadow";
    if (mode === "production" && body?.confirm_activation !== true) return json({ ok: false, error: "production_requires_confirm_activation" }, 400);
    return json(await main(mode));
  } catch (error) {
    return json({ ok: false, error: String(error) }, 409);
  }
});
