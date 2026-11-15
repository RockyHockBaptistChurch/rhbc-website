// RHBC website Worker.
// - Bulletin and newsletter PDFs and gallery photos come from the R2 bucket (binding FILES).
// - Staff sign-in: Cloudflare Access protects /sign-in (and /api/staff/*). This Worker checks the
//   Access sign-in token itself on every staff request, then saves to GitHub with the church key
//   (secret GITHUB_TOKEN), so staff never handle GitHub keys.
// - Everything else is a static file from the repository (binding ASSETS).
//
// Settings (Workers & Pages > rhbc-website > Settings > Variables and Secrets):
//   ACCESS_TEAM   variable  the Zero Trust team domain, e.g. rhbc.cloudflareaccess.com
//   ACCESS_AUD    variable  the Access application's Audience (AUD) tag
//   GITHUB_TOKEN  secret    fine-grained GitHub key: rhbc-website only, Contents read and write
//   STAFF_NAMES   variable  optional, names for emails not on the Our Staff page:
//                           {"someone@example.com": "Their Name"}
//   COPY_UPLOADS_TO_GITHUB  "yes" (in wrangler.jsonc) also saves new PDFs and photos to GitHub
//                           until GitHub Pages is turned off; "no" = R2 only.

const R2_FOLDERS = ["/bulletins/", "/newsletters/", "/photos/"];
const TYPES = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic" };
const REPO = "RockyHockBaptistChurch/rhbc-website";
const BRANCH = "main";
const MAX_UPLOAD = 60 * 1024 * 1024; // 60 MB

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/sign-in") return await signIn(request, env, url);
      if (p === "/api/me") return await me(request, env);
      if (p === "/api/sign-out") return signOut(url);
      if (p.startsWith("/api/staff/")) return await staff(request, env, url);
      if (p.startsWith("/api/")) return json({ error: "not found" }, 404);
    } catch (e) {
      console.error("[RHBC] staff request failed", p, e && e.stack || e);
      return json({ error: "server", status: e.status || 500 }, e.status === 409 ? 409 : 502);
    }
    if (R2_FOLDERS.some((f) => p.startsWith(f))) return serveFile(request, env, url);
    return env.ASSETS.fetch(request);
  },
};

// ---------- sign-in ----------

const ready = (env) => !!(env.ACCESS_TEAM && env.ACCESS_AUD && env.GITHUB_TOKEN);

async function signIn(request, env, url) {
  // Only lets the page come back to a hash route such as #calendar.
  const to = /^#[A-Za-z0-9_-]{0,40}$/.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : "";
  let state = "not-set-up";
  if (ready(env)) state = (await who(request, env)) ? "signed-in" : "not-allowed";
  return new Response(null, { status: 302, headers: { Location: "/?staff=" + state + to, "Cache-Control": "no-store" } });
}

function signOut(url) {
  // Ends the sign-in on this website. The page then also calls Cloudflare's own logout.
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/cdn-cgi/access/logout",
      "Set-Cookie": "CF_Authorization=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
      "Cache-Control": "no-store",
    },
  });
}

async function me(request, env) {
  if (!ready(env)) return json({ setup: false, signedIn: false });
  const user = await who(request, env);
  if (!user) return json({ setup: true, signedIn: false });
  const ref = await gh(env, "/git/ref/heads/" + BRANCH);
  const head = ref.object.sha;
  const data = await gh(env, "/contents/data/site.json?ref=" + head, { raw: true });
  return json({
    setup: true, signedIn: true, email: user.email, name: staffName(env, user.email, data),
    head, data, copyToGitHub: copyToGitHub(env),
  });
}

// ---------- staff actions (all need a valid sign-in) ----------

async function staff(request, env, url) {
  if (!ready(env)) return json({ error: "not set up" }, 503);
  const user = await who(request, env);
  if (!user) return json({ error: "signed out" }, 401);
  const action = url.pathname.slice("/api/staff/".length);

  if (action === "exists" && request.method === "GET") {
    const path = cleanPath(url.searchParams.get("path"));
    if (!path) return json({ error: "bad path" }, 400);
    if (inR2(path) && (await env.FILES.head(path))) return json({ exists: true });
    try { await gh(env, "/contents/" + encPath(path) + "?ref=" + BRANCH); return json({ exists: true }); }
    catch (e) { if (e.status === 404) return json({ exists: false }); throw e; }
  }

  // Changes must come from the site itself.
  if (request.headers.get("Origin") !== url.origin || request.headers.get("X-RHBC-Staff") !== "1") {
    return json({ error: "forbidden" }, 403);
  }

  if (action === "upload" && request.method === "PUT") {
    const path = cleanPath(url.searchParams.get("path"));
    if (!path || !inR2(path) || !TYPES[ext(path)]) return json({ error: "bad path" }, 400);
    const size = Number(request.headers.get("Content-Length") || 0);
    if (size > MAX_UPLOAD) return json({ error: "too large" }, 413);
    if (await env.FILES.head(path)) return json({ error: "exists" }, 409);
    const body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_UPLOAD) return json({ error: "bad size" }, 400);
    await env.FILES.put(path, body, {
      httpMetadata: { contentType: TYPES[ext(path)] },
      customMetadata: { uploadedBy: user.email },
    });
    console.log("[RHBC] upload", path, body.byteLength, "by", user.email);
    return json({ ok: true, path });
  }

  if (action === "blob" && request.method === "POST") {
    // Passes a file (already base64 JSON from the page) straight to GitHub without re-reading it.
    const size = Number(request.headers.get("Content-Length") || 0);
    if (size > MAX_UPLOAD * 1.4) return json({ error: "too large" }, 413);
    const r = await gh(env, "/git/blobs", { method: "POST", body: await request.text() });
    return json({ sha: r.sha });
  }

  if (action === "save" && request.method === "POST") {
    const { base, data, files, uploaded } = await request.json();
    if (!/^[0-9a-f]{40}$/.test(base || "") || typeof data !== "string") return json({ error: "bad request" }, 400);
    try { if (typeof JSON.parse(data) !== "object") throw 0; } catch { return json({ error: "bad data" }, 400); }
    const list = Array.isArray(files) ? files : [];
    for (const f of list) {
      if (!cleanPath(f.path) || f.path.startsWith("data/") || !/^[0-9a-f]{40}$/.test(f.sha || "")) return json({ error: "bad file" }, 400);
    }
    const ref = await gh(env, "/git/ref/heads/" + BRANCH);
    if (ref.object.sha !== base) return json({ error: "conflict" }, 409);
    const commit = await gh(env, "/git/commits/" + base);
    const blob = await gh(env, "/git/blobs", { method: "POST", body: JSON.stringify({ content: data, encoding: "utf-8" }) });
    const tree = await gh(env, "/git/trees", {
      method: "POST",
      body: JSON.stringify({
        base_tree: commit.tree.sha,
        tree: [...list.map((f) => ({ path: f.path, mode: "100644", type: "blob", sha: f.sha })),
          { path: "data/site.json", mode: "100644", type: "blob", sha: blob.sha }],
      }),
    });
    const name = staffName(env, user.email, data);
    const added = [...new Set([...list.map((f) => f.path), ...(Array.isArray(uploaded) ? uploaded.filter((u) => cleanPath(u) && inR2(u)) : [])])];
    const message = "Update website content (saved by " + name + ")" +
      (added.length ? "\n\nAdded:\n" + added.map((f) => "- " + f).join("\n") : "") + "\n\nSaved-By: " + name;
    const c = await gh(env, "/git/commits", { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [base] }) });
    try {
      await gh(env, "/git/refs/heads/" + BRANCH, { method: "PATCH", body: JSON.stringify({ sha: c.sha, force: false }) });
    } catch (e) {
      if (e.status === 422) return json({ error: "conflict" }, 409);
      throw e;
    }
    console.log("[RHBC] saved", c.sha, "by", user.email, added);
    return json({ ok: true, head: c.sha });
  }

  return json({ error: "not found" }, 404);
}

// ---------- helpers ----------

const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const ext = (p) => p.split(".").pop().toLowerCase();
const inR2 = (p) => R2_FOLDERS.some((f) => ("/" + p).startsWith(f));
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
const copyToGitHub = (env) => String(env.COPY_UPLOADS_TO_GITHUB || "yes").toLowerCase() !== "no";

// Only files in the site's upload folders, no tricks with ".." or odd characters.
function cleanPath(p) {
  if (typeof p !== "string" || p.length > 200) return null;
  if (!/^(bulletins|newsletters|photos|staff|files)\/[^\\:*?"<>|\x00-\x1f]+$/.test(p) && p !== "data/site.json") return null;
  if (p.split("/").some((s) => !s || s === "." || s === "..")) return null;
  return p;
}

function staffName(env, email, dataText) {
  const e = String(email || "").toLowerCase();
  try {
    const extra = env.STAFF_NAMES ? JSON.parse(env.STAFF_NAMES) : {};
    for (const k in extra) if (k.toLowerCase() === e) return String(extra[k]);
  } catch {}
  try {
    const d = typeof dataText === "string" ? JSON.parse(dataText) : dataText;
    const s = (d.staff || []).find((x) => String(x.email || "").toLowerCase() === e);
    if (s && s.name) return s.name;
  } catch {}
  return e.split("@")[0] || "staff";
}

async function gh(env, path, opt = {}) {
  const r = await fetch((env.GITHUB_API || "https://api.github.com") + "/repos/" + REPO + path, {
    method: opt.method || "GET",
    body: opt.body,
    headers: {
      Accept: opt.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rhbc-website-worker",
      ...(opt.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!r.ok) {
    const e = new Error("github " + r.status + " " + path.split("?")[0]);
    e.status = r.status;
    throw e;
  }
  return opt.raw ? r.text() : r.json();
}

// ---------- Cloudflare Access sign-in token ----------

let certs = { at: 0, keys: [] };

async function who(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || cookie(request, "CF_Authorization");
  if (!token) return null;
  try {
    const [h, p, s] = token.split(".");
    const head = JSON.parse(b64url(h, true));
    const claims = JSON.parse(b64url(p, true));
    const team = "https://" + String(env.ACCESS_TEAM).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const now = Date.now() / 1000;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (head.alg !== "RS256" || claims.iss !== team || !aud.includes(env.ACCESS_AUD)) return null;
    if (!(claims.exp > now) || (claims.nbf && claims.nbf > now + 60) || !claims.email) return null;
    const jwk = await findKey(env, team, head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(s), new TextEncoder().encode(h + "." + p));
    return ok ? { email: String(claims.email) } : null;
  } catch (e) {
    console.warn("[RHBC] sign-in token not accepted:", e && e.message);
    return null;
  }
}

async function findKey(env, team, kid) {
  const pick = () => certs.keys.find((k) => k.kid === kid);
  if (Date.now() - certs.at < 3600e3 && pick()) return pick();
  const r = await fetch(env.ACCESS_CERTS_URL || team + "/cdn-cgi/access/certs");
  if (!r.ok) throw new Error("certs " + r.status);
  certs = { at: Date.now(), keys: (await r.json()).keys || [] };
  return pick();
}

function cookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}

function b64url(s, asText) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const u = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return asText ? new TextDecoder().decode(u) : u;
}

// ---------- files from R2 ----------

async function serveFile(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  let key;
  try {
    key = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  const obj = await env.FILES.get(key, { range: request.headers, onlyIf: request.headers });
  if (obj === null) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("content-type", TYPES[ext(key)] || headers.get("content-type") || "application/octet-stream");
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=86400");

  // Conditional request matched (not modified)
  if (!("body" in obj)) return new Response(null, { status: 304, headers });

  let status = 200;
  if (obj.range && request.headers.has("range")) {
    const { offset = 0, length = obj.size - offset } = obj.range;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    status = 206;
  } else {
    headers.set("content-length", String(obj.size));
  }
  return new Response(request.method === "HEAD" ? null : obj.body, { status, headers });
}
