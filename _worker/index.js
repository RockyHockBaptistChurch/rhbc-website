// RHBC website Worker.
// Bulletin and newsletter PDFs come from the R2 bucket (binding FILES);
// everything else is a static file from the repository (binding ASSETS).
const PDF_FOLDERS = ["/bulletins/", "/newsletters/"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (PDF_FOLDERS.some((p) => url.pathname.startsWith(p))) {
      return servePdf(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};

async function servePdf(request, env, url) {
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
  headers.set("content-type", "application/pdf");
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
