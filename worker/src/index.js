/**
 * Cloudflare Worker: Google Vision OCR proxy with monthly quota.
 * Receives POST { image: dataUrl-or-base64 } → returns { text: string }.
 *
 * Required env:
 *   GOOGLE_VISION_API_KEY  — Google Cloud Vision API key (Secret)
 *   ALLOWED_ORIGINS        — comma-separated list (Variable)
 *   COUNTER                — KV namespace binding for monthly counter
 */

const DEFAULT_ALLOWED = "https://zoids901-debug.github.io";
const MONTHLY_LIMIT = 1000;

async function checkAndIncrement(env) {
  if (!env.COUNTER) return { ok: true, count: 0, skipped: true };
  const yearMonth = new Date().toISOString().slice(0, 7); // "2026-05"
  const key = `count:${yearMonth}`;
  const current = parseInt(await env.COUNTER.get(key) || "0", 10);
  if (current >= MONTHLY_LIMIT) return { ok: false, count: current };
  await env.COUNTER.put(key, String(current + 1), { expirationTtl: 40 * 86400 });
  return { ok: true, count: current + 1 };
}

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ALLOWED).split(",").map(s => s.trim());
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = allowed.includes("*") || allowed.includes(origin) ? origin || "*" : "";
    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);
    if (!allowOrigin) return json({ error: "origin not allowed" }, 403, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON" }, 400, cors);
    }

    let image = body.image || "";
    if (!image) return json({ error: "missing image field" }, 400, cors);
    image = image.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
    // Roughly 5 MB max base64 (≈ 3.7 MB binary)
    if (image.length > 7_000_000) return json({ error: "image too large" }, 413, cors);

    const apiKey = env.GOOGLE_VISION_API_KEY;
    if (!apiKey) return json({ error: "server misconfigured: missing API key" }, 500, cors);

    // Monthly quota check
    const quota = await checkAndIncrement(env);
    if (!quota.ok) {
      return json({
        error: `이번 달 OCR 호출 한도(${MONTHLY_LIMIT}회) 초과. 다음 달 1일 자동 리셋됩니다.`,
        count: quota.count,
        limit: MONTHLY_LIMIT,
      }, 429, cors);
    }

    const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
    const visionResp = await fetch(visionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: image },
          features: [{ type: "TEXT_DETECTION" }],
          imageContext: { languageHints: ["ko", "en"] },
        }],
      }),
    });

    if (!visionResp.ok) {
      const errText = await visionResp.text();
      return json({ error: `Google Vision error: ${visionResp.status}`, detail: errText.slice(0, 500) }, 502, cors);
    }

    const data = await visionResp.json();
    const text = data?.responses?.[0]?.fullTextAnnotation?.text || "";
    return json({
      text,
      quota: { used: quota.count, limit: MONTHLY_LIMIT, remaining: MONTHLY_LIMIT - quota.count },
    }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
