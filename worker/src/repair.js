// GET /repair?plz=85049&dev=washer
// Repair cafés and repair shops near a German postcode, from OpenStreetMap (Overpass API).
// Data © OpenStreetMap contributors, ODbL. Results per postcode are cached (no user data involved).

import { UA, fetchWithTimeout, haversineKm } from "./util.js";

export const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
export const DEVICES = ["washer", "dish", "fridge", "dryer", "tv", "phone", "tablet", "cordless", "heater", "vacuum", "ebike", "other", "any"];
const RADIUS_M = 15000;
const MAX_PLACES = 25;
const CACHE_SECONDS = 86400;
const memCache = new Map();

const APPLIANCE = ["washer", "dish", "fridge", "dryer", "heater", "vacuum"];
const PHONE = ["phone", "tablet", "cordless"];

export function overpassCenterQuery(plz) {
  return `[out:json][timeout:20];rel["boundary"="postal_code"]["postal_code"="${plz}"];out center tags 1;`;
}

export function overpassPlacesQuery(lat, lon) {
  const a = `(around:${RADIUS_M},${lat},${lon})`;
  return `[out:json][timeout:25];
is_in(${lat},${lon})->.a;
area.a["boundary"="administrative"]["admin_level"="4"];
out tags;
(
  nwr["repair"="assisted_self_service"]${a};
  nwr["craft"="electronics_repair"]${a};
  nwr["shop"~"^(mobile_phone|electronics|appliance|computer|vacuum_cleaner|hifi)$"]["repair"~"yes|only"]${a};
  nwr["shop"="mobile_phone"]["service:mobile_phone:repair"="yes"]${a};
  nwr["shop"="bicycle"]["service:bicycle:repair"="yes"]${a};
);
out center tags 150;`;
}

async function overpass(query) {
  let lastErr = "unavailable";
  for (const endpoint of OVERPASS) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: "data=" + encodeURIComponent(query),
      }, 25000);
      if (res.ok) return await res.json();
      lastErr = res.status === 429 ? "busy" : "unavailable";
    } catch {
      lastErr = "unavailable";
    }
  }
  throw new Error(lastErr);
}

// What kind of place is this, and does it fit the device?
export function classify(tags, dev) {
  const er = (tags.electronics_repair || "").toLowerCase();
  const shop = tags.shop || "";
  if (tags.repair === "assisted_self_service" || /repair.?caf/i.test(tags.name || "")) return { kind: "cafe", score: 3 };
  const fitsAppliance = /appliance|household|white_goods|domestic/.test(er) || shop === "appliance" || shop === "vacuum_cleaner";
  const fitsPhone = /phone|mobile|tablet|computer/.test(er) || shop === "mobile_phone" || shop === "computer" || tags["service:mobile_phone:repair"] === "yes";
  const fitsTv = /tv|television|audio|video|hifi/.test(er) || shop === "hifi" || shop === "electronics";
  if (shop === "bicycle") return dev === "ebike" || dev === "any" ? { kind: "bike", score: 2 } : null;
  if (dev === "ebike") return null;
  if (dev === "any" || dev === "other") return { kind: "shop", score: 1 };
  if (APPLIANCE.includes(dev)) return fitsAppliance ? { kind: "shop", score: 2 } : (!er && tags.craft === "electronics_repair" ? { kind: "shop", score: 1 } : null);
  if (PHONE.includes(dev)) return fitsPhone ? { kind: "shop", score: 2 } : (!er && tags.craft === "electronics_repair" ? { kind: "shop", score: 1 } : null);
  if (dev === "tv") return fitsTv ? { kind: "shop", score: 2 } : (!er && tags.craft === "electronics_repair" ? { kind: "shop", score: 1 } : null);
  return { kind: "shop", score: 1 };
}

function cleanUrl(v) {
  if (!v) return null;
  let s = String(v).trim().split(/[;\s]/)[0];
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function shapePlaces(elements, center, dev) {
  const out = [];
  const seen = new Set();
  for (const el of elements || []) {
    if (el.type === "area" || !el.tags) continue;
    const t = el.tags;
    if (!t.name) continue;
    const c = el.type === "node" ? { lat: el.lat, lon: el.lon } : el.center;
    if (!c) continue;
    const cls = classify(t, dev);
    if (!cls) continue;
    const key = t.name.toLowerCase() + "|" + (t["addr:street"] || "");
    if (seen.has(key)) continue;
    seen.add(key);
    const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
    const city = [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" ");
    out.push({
      name: t.name.slice(0, 120),
      kind: cls.kind,
      street: street.slice(0, 120) || null,
      city: city.slice(0, 80) || null,
      hours: (t.opening_hours || "").slice(0, 160) || null,
      website: cleanUrl(t.website || t["contact:website"]),
      osm: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      km: Math.round(haversineKm(center, c) * 10) / 10,
      score: cls.score,
    });
  }
  // Best match for the device first, then the closest
  out.sort((a, b) => b.score - a.score || a.km - b.km);
  return out.slice(0, MAX_PLACES).map(({ score, ...p }) => p);
}

export async function lookupRepair(plz, dev, { cache } = {}) {
  const key = `repair:v1:${plz}:${dev}`;
  const now = Date.now();
  const mem = memCache.get(key);
  if (mem && now - mem.t < CACHE_SECONDS * 1000) return mem.v;
  if (cache) {
    try {
      const hit = await cache.get(key, "json");
      if (hit) return hit;
    } catch {}
  }

  const c = await overpass(overpassCenterQuery(plz));
  const rel = (c.elements || []).find((e) => e.center);
  if (!rel) {
    const v = { error: "plz_not_found" };
    return v;
  }
  const center = { lat: Math.round(rel.center.lat * 1e4) / 1e4, lon: Math.round(rel.center.lon * 1e4) / 1e4 };
  const p = await overpass(overpassPlacesQuery(center.lat, center.lon));
  const stateEl = (p.elements || []).find((e) => e.type === "area" && e.tags && e.tags.admin_level === "4");
  const state = stateEl ? (stateEl.tags["name:de"] || stateEl.tags.name || null) : null;
  const v = {
    plz,
    state,
    center,
    places: shapePlaces(p.elements, center, dev),
    radius_km: RADIUS_M / 1000,
    attribution: "© OpenStreetMap contributors, ODbL",
  };
  memCache.set(key, { t: now, v });
  if (memCache.size > 500) memCache.clear();
  if (cache) {
    try { await cache.put(key, JSON.stringify(v), { expirationTtl: CACHE_SECONDS }); } catch {}
  }
  return v;
}

export const REPAIR_CACHE_SECONDS = CACHE_SECONDS;
