import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { GetObjectCommand, S3Client } from "npm:@aws-sdk/client-s3";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REGION = Deno.env.get("S3_REGION") ?? Deno.env.get("AWS_REGION") ?? "eu-central-1";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const MAX_FIXTURES = 25;
const CALIBRATION_POLICY = "temperature-1x2-v1";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
}
async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function poisson(k: number, l: number) {
  let f = 1; for (let i = 2; i <= k; i++) f *= i;
  return Math.exp(k * Math.log(l) - l) / f;
}
function probs(lh: number, la: number, rho: number, maxG: number) {
  let t = 0, h = 0, d = 0, a = 0;
  for (let x = 0; x <= maxG; x++) for (let y = 0; y <= maxG; y++) {
    let tc = 1;
    if (x === 0 && y === 0) tc = 1 - lh * la * rho;
    else if (x === 0 && y === 1) tc = 1 + lh * rho;
    else if (x === 1 && y === 0) tc = 1 + la * rho;
    else if (x === 1 && y === 1) tc = 1 - rho;
    const p = poisson(x, lh) * poisson(y, la) * Math.max(0, tc);
    t += p; if (x > y) h += p; else if (x === y) d += p; else a += p;
  }
  if (!(t > 0)) throw new Error("invalid_probability_mass");
  return { home: h / t, draw: d / t, away: a / t };
}
function temperatureScale(p: {home:number; draw:number; away:number}, temperature: number) {
  const raw = [Math.max(1e-15, p.home), Math.max(1e-15, p.draw), Math.max(1e-15, p.away)];
  const z = raw.map(x => Math.log(x) / temperature);
  const pivot = Math.max(...z); const w = z.map(x => Math.exp(x - pivot)); const s = w.reduce((a,b) => a+b, 0);
  return { home: w[0]/s, draw: w[1]/s, away: w[2]/s };
}
async function calibrationPolicy() {
  const { data, error } = await db.from("policy_versions").select("version,payload").eq("policy_type", "prediction_calibration").eq("version", CALIBRATION_POLICY).maybeSingle();
  if (error || !data) return { version: CALIBRATION_POLICY, temperature: 1, status: "IDENTITY_FALLBACK" };
  const payload = (data.payload ?? {}) as Record<string, unknown>;
  const t = Number(payload.temperature ?? 1);
  const status = String(payload.status ?? "UNKNOWN").toUpperCase();
  const minN = Number(payload.min_calibration_samples ?? 300);
  if ((status !== "VALIDATED" && status !== "ACTIVE") || !Number.isFinite(t) || t < 0.60 || t > 1.00 || minN < 300) {
    return { version: String(data.version), temperature: 1, status: "IDENTITY_FALLBACK" };
  }
  return { version: String(data.version), temperature: t, status };
}
async function artifact(uri: string) {
  const m = uri.match(/^s3:\/\/([^/]+)\/(.+)$/); if (!m) throw new Error("invalid_model_artifact_uri");
  const s3 = new S3Client({ region: REGION, credentials: { accessKeyId: Deno.env.get("S3_ACCESS_KEY_ID") ?? Deno.env.get("AWS_ACCESS_KEY_ID") ?? "", secretAccessKey: Deno.env.get("S3_SECRET_ACCESS_KEY") ?? Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? "" } });
  const o = await s3.send(new GetObjectCommand({ Bucket: m[1], Key: m[2] }));
  const text = await o.Body?.transformToString("utf-8"); if (!text) throw new Error("empty_model_artifact");
  const a = JSON.parse(text); return { artifact: a, sha: await sha256(text) };
}
async function candidate() {
  const { data: rels, error } = await db.from("model_releases").select("model_version_id,release_version,status,approval_state,created_at,reason").eq("status", "SHADOW").order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  for (const r of rels ?? []) {
    const { data: m, error: e } = await db.from("model_versions").select("id,version,status,artifact_uri,training_cutoff").eq("id", r.model_version_id).single();
    if (!e && m?.artifact_uri) return { release: r, model: m };
  }
  throw new Error("no_shadow_model_artifact_available");
}
async function gate(modelId: string) {
  const { data, error } = await db.from("prediction_training_runs").select("id,status,metrics,started_at").eq("model_version_id", modelId).order("started_at", { ascending: false }).limit(1);
  if (error) throw error;
  const r = data?.[0], g = r?.metrics?.benchmark_gate ?? null;
  return { training_run_id: r?.id ?? null, training_status: r?.status ?? null, gate_status: g?.status ?? "UNKNOWN", promotion_eligible: g?.promotion_eligible === true };
}
async function ensurePolicy() {
  const { data, error } = await db.from("policy_versions").select("id,version,payload").eq("policy_type", "prediction").eq("version", "prediction-v1").maybeSingle();
  if (error) throw error; if (data) return data;
  const r = await db.from("policy_versions").insert({ policy_type: "prediction", version: "prediction-v1", payload: { schema_version: "prediction-policy-v1", default_mode: "shadow", activation_requires: ["ACTIVE", "APPROVED", "promotion_eligible=true"], markets: ["1x2_home", "1x2_draw", "1x2_away"] } }).select("id,version,payload").single();
  if (r.error) throw r.error; return r.data;
}
async function ensureMarkets() {
  const rows = [
    { market_key: "1x2_home", family: "1X2", settlement_type: "HOME_WIN", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
    { market_key: "1x2_draw", family: "1X2", settlement_type: "DRAW", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" },
    { market_key: "1x2_away", family: "1X2", settlement_type: "AWAY_WIN", status: "EXPERIMENTAL", production_policy_version: "prediction-v1" }
  ];
  const r = await db.from("market_registry").upsert(rows, { onConflict: "market_key" }); if (r.error) throw r.error;
}
function predict(f: any, a: any, temperature: number) {
  const elo = a.elo ?? {}, dc = a.dixon_coles ?? {}, rs = elo.ratings ?? {};
  const rating = (t: string) => Number(rs[t]?.rating ?? rs[t] ?? elo.initial_rating ?? 1500);
  const rh = rating(f.home_team_id), ra = rating(f.away_team_id);
  const edge = 1 / (1 + Math.exp(-((rh + Number(elo.home_advantage ?? 60)) - ra) / Number(elo.rating_scale ?? 400) * 2.302585092994046));
  const atk = dc.attack ?? {}, def = dc.defense ?? {}, rate = Math.max(Number(dc.league_rate ?? 1.2), .05);
  const lh = Math.max(.05, rate * Math.exp(Number(dc.home_advantage ?? .15)) * Number(atk[f.home_team_id] ?? 1) / Math.max(Number(def[f.away_team_id] ?? 1), .05) * (.75 + .5 * edge));
  const la = Math.max(.05, rate * Number(atk[f.away_team_id] ?? 1) / Math.max(Number(def[f.home_team_id] ?? 1), .05) * (1.25 - .5 * edge));
  const raw = probs(lh, la, Number(dc.rho ?? -.1), Math.min(Math.max(Number(dc.max_goals ?? 10), 1), 12));
  return { lambdas: { home: lh, away: la }, raw_probabilities: raw, probabilities: temperatureScale(raw, temperature) };
}
async function run() {
  const { release, model } = await candidate();
  const training = await gate(model.id);
  const policy = await ensurePolicy(); await ensureMarkets();
  const calibration = await calibrationPolicy();
  const a = await artifact(model.artifact_uri);
  const { data: fixtures, error } = await db.from("fixtures").select("id,home_team_id,away_team_id,kickoff_at,status").eq("status", "scheduled").gte("kickoff_at", new Date().toISOString()).order("kickoff_at", { ascending: true }).limit(MAX_FIXTURES);
  if (error) throw error;
  const previews = (fixtures ?? []).map(f => ({ fixture_id: f.id, kickoff_at: f.kickoff_at, ...predict(f, a.artifact, calibration.temperature) }));
  return { ok: true, mode: "shadow", model: { id: model.id, version: model.version, release_version: release.release_version, artifact_sha256: a.sha }, training, policy_bundle_id: policy.id, calibration, fixtures_considered: previews.length, shadow_persistence: "disabled_until_gate", previews };
}
Deno.serve(async req => { if (req.method !== "POST") return response({ ok: false, error: "POST required" }, 405); try { return response(await run()); } catch (e) { return response({ ok: false, error: String(e) }, 409); } });
