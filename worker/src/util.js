// Shared helpers for the Secondwind Worker. Nothing here stores or logs user input.

export const UA = "Secondwind/3 (free right-to-repair helper; +https://dhanush-satish-reddy.github.io/secondwind/)";

export function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function json(body, status, origin, extra = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export async function hashKey(ip, salt = "secondwind") {
  const data = new TextEncoder().encode(salt + ":" + ip);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Fallback limiter if a binding is missing (best effort, per instance, in memory only)
const memHits = new Map();
export function memLimit(key, limit, windowMs = 60000) {
  const now = Date.now();
  const arr = (memHits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  memHits.set(key, arr);
  if (memHits.size > 5000) memHits.clear();
  return arr.length <= limit;
}

export async function rateLimit(request, binding, name, limit) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await hashKey(ip, "secondwind-" + name);
  try {
    return binding ? (await binding.limit({ key })).success : memLimit(name + key, limit);
  } catch {
    return memLimit(name + key, limit);
  }
}

export async function fetchWithTimeout(url, init = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Only public web addresses: no IPs, no localhost, no internal names, standard ports only.
export function safeUrl(input) {
  let u;
  try {
    const s = String(input || "").trim();
    if (!s || s.length > 300) return null;
    u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h.includes(".")) return null;
  if (/^\d+(\.\d+){3}$/.test(h) || h.startsWith("[") || h.includes(":")) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa|test|invalid|example)$/.test(h)) return null;
  if (!/^[a-z0-9.-]+$/.test(h)) return null; // punycode only
  u.protocol = "https:";
  u.hash = "";
  return u;
}

// Fetch a public HTML page, following at most 3 redirects, each one re-checked. Returns {url, html} or null.
export async function fetchPage(input, { maxBytes = 300000, ms = 8000 } = {}) {
  let u = safeUrl(input);
  for (let hop = 0; u && hop < 4; hop++) {
    let res;
    try {
      res = await fetchWithTimeout(u.toString(), {
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "de-DE,de;q=0.9,en;q=0.5" },
      }, ms);
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location");
      u = loc ? safeUrl(new URL(loc, u).toString()) : null;
      continue;
    }
    if (!res.ok) return null;
    const type = res.headers.get("Content-Type") || "";
    if (!/text\/html|application\/xhtml/i.test(type)) return null;
    const html = await readCapped(res, maxBytes);
    return { url: u.toString(), html };
  }
  return null;
}

async function readCapped(res, maxBytes) {
  if (!res.body || !res.body.getReader) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  try { reader.cancel(); } catch {}
  const all = new Uint8Array(Math.min(size, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.length, all.length - off));
    all.set(part, off);
    off += part.length;
    if (off >= all.length) break;
  }
  return new TextDecoder("utf-8").decode(all);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", agrave: "à", ndash: "–", mdash: "—", middot: "·", copy: "©" };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[e] ?? m;
  });
}

// HTML -> plain text lines (block elements and <br> become line breaks)
export function htmlToLines(html) {
  const text = html
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|address|section|article|dd|dt|td|th|span)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/[ \t   ]+/g, " ").trim())
    .filter(Boolean);
}

export function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
