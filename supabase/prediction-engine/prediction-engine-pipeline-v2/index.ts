import { GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_BUCKET = Deno.env.get("S3_BUCKET") ?? Deno.env.get("AWS_S3_BUCKET") ?? "zahrly-community-storage";
const REGION = Deno.env.get("S3_REGION") ?? Deno.env.get("AWS_REGION") ?? "eu-central-1";
const MAX_FIXTURES = 25;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
}

function s3Credentials() {
  const accessKeyId = Deno.env.get("S3_ACCESS_KEY_ID") ?? Deno.env.get("AWS_ACCESS_KEY_ID") ?? Deno.env.get("AWS_ACCESS_KEY");
  const secretAccessKey = Deno.env.get("S3_SECRET_ACCESS_KEY") ?? Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? Deno.env.get("AWS_SECRET_KEY");
  if (!accessKeyId || !secretAccessKey) throw new Error("s3_credentials_missing");
  return { accessKeyId, secretAccessKey };
}

async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
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

function oneX2(lh: number, la: number, rho: number, maxGoals: number) {
  let total = 0, home = 0, draw = 0, away = 0;
  for (let h = 0; h <= maxGoals; h++) for (let a = 0; a <= maxGoals; a++) {
    const p = poisson(h, lh) * poisson(a, la) * Math.max(0, tau(h, a, rho, lh, la));
    total += p;
    if (h > a) home += p; else if (h === a) draw += p; else away += p;
  }
  if (!(total > 0)) throw new Error("invalid_probability_mass");
  return { home: home / total, draw: draw / total, away: away / total };
}

async function readArtifact(uri: string) {
  const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error("invalid_model_artifact_uri");
  const [, bucket, key] = match;
  const s3 = new S3Client({ region: REGION, credentials: s3Credentials() });
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket || DEFAULT_BUCKET, Key: key }));
  const text = await object.Body?.transformToString("utf-8");
  if (!text) throw new Error("empty_model_artifact");
  return { artifact: JSON.parse(text), sha256: await sha256(text) };
}

async function findCandidate(mode: "shadow" | "production") {
  let q = db.from("model_releases").select("model_version_id,release_version,status,approval_state,created_at,reason").order("created_at", { ascending: false }).limit(20);
  if (mode === "production") q = q.eq("status", "ACTIVE").eq("approval_state", "APPROVED"); else q = q.eq("status", "SHADOW");
  const { data: releases, error } = await q;
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
  const latest = data?.[0];
  const g = latest?.metrics?.benchmark_gate ?? null;
  return { training_run_id: latest?.id ?? null, training_status: latest?.status ?? null, gate_status: g?.status ?? "UNKNOWN", promotion_eligible: g?.promotion_eligible === true };
}

async function ensurePolicy() {
  const { data: existing, error } = await db.from("policy_versions").select("id,version,payload").eq("policy_type", "prediction").eq("version", "prediction-v1").maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const payload = { schema_version: "prediction-policy-v1", markets: ["1x2_home", "1x2_draw", "1x2_away"], default_mode: "shadow", activation_requires_gate: true };
  const { data, error: insertError } = await db.from("policy_versions").insert({ policy_type: "prediction", version: "prediction-v1", payload }).select("id,version,payload").single();
  if (insertError) throw insertError;
  return data;
}

async function ensureMarkets() {
  const rows = [
    { market_key: "1x2_home", family: "1X2", settlement_type: "HOME_WIN", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
    { market_key: "1x2_draw", family: "1X2", settlement_type: "DRAW", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
    { market_key: "1x2_away", family: "1X2", settlement_type: "AWAY_WIN", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
  ];
  const { error } = await db.from("market_registry").upsert(rows, { onConflict: "market_key" });
  if (error) throw error;
}

function predict(fixture: any, artifact: any) {
  const elo = artifact.elo ?? {}, dc = artifact.dixon_coles ?? {};
  const ratings = elo.ratings ?? {};
  const readRating = (team: string) => Number(ratings[team]?.rating ?? ratings[team] ?? elo.initial_rating ?? 1500);
  const rh = readRating(fixture.home_team_id), ra = readRating(fixture.away_team_id);
  const edge = 1 / (1 + Math.exp(-((rh + Number(elo.home_advantage ?? 60)) - ra) / Number(elo.rating_scale ?? 400) * 2.302585092994046));
  const attack = dc.attack ?? {}, defense = dc.defense ?? {};
  const rate = Math.max(Number(dc.league_rate ?? 1.2), 0.05);
  const ha = Number(attack[fixture.home_team_id] ?? 1), aa = Number(attack[fixture.away_team_id] ?? 1);
  const hd = Number(defense[fixture.home_team_id] ?? 1), ad = Number(defense[fixture.away_team_id] ?? 1);
  const lh = Math.max(0.05, rate * Math.exp(Number(dc.home_advantage ?? 0.15)) * ha / Math.max(ad, 0.05) * (0.75 + 0.5 * edge));
  const la = Math.max(0.05, rate * aa / Math.max(hd, 0.05) * (1.25 - 0.5 * edge));
  return { lambdas: { home: lh, away: la }, probabilities: oneX2(lh, la, Number(dc.rho ?? -0.10), Math.min(Math.max(Number(dc.max_goals ?? 10), 1), 12)) };
}

async function plan(mode: "shadow" | "production") {
  const { release, model } = await findCandidate(mode);
  const training = await gate(model.id);
  if (mode === "production" && !training.promotion_eligible) throw new Error(`production_activation_blocked:${training.gate_status}`);
  const policy = await ensurePolicy();
  await ensureMarkets();
  const { data: fixtures, error } = await db.from("fixtures").select("id,home_team_id,away_team_id,kickoff_at,status").eq("status", "scheduled").gte("kickoff_at", new Date().toISOString()).order("kickoff_at", { ascending: true }).limit(MAX_FIXTURES);
  if (error) throw error;
  const { artifact, sha256: artifactSha256 } = await readArtifact(model.artifact_uri);
  const previews = (fixtures ?? []).map((fixture) => ({ fixture_id: fixture.id, kickoff_at: fixture.kickoff_at, ...predict(fixture, artifact) }));
  return { ok: true, mode, model: { id: model.id, version: model.version, release_version: release.release_version, artifact_sha256: artifactSha256 }, training, policy_bundle_id: policy.id, fixtures_considered: previews.length, shadow_persistence: mode === "shadow" ? "disabled_by_design_until_gate" : "enabled_after_gate", previews };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ ok: false, error: "POST required" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === "production" ? "production" : "shadow";
    if (mode === "production" && body?.confirm_activation !== true) return reply({ ok: false, error: "production_requires_confirm_activation" }, 400);
    return reply(await plan(mode));
  } catch (error) {
    return reply({ ok: false, error: String(error) }, 409);
  }
});
