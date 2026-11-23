// Builds the repair-place data for "Wo reparieren?" from OpenStreetMap (Overpass API).
// Run by the GitHub workflow .github/workflows/refresh-repair-data.yml (monthly), or by hand: node tools/build-repair-data.mjs
// Output (all © OpenStreetMap contributors, ODbL):
//   data/plz/0.json … 9.json      postcode -> [lat, lon, state codes]
//   data/repair/<lat>_<lon>.json  repair places, one file per 1°×1° tile
//   data/meta.json                date and counts
import { mkdir, writeFile, rm } from "node:fs/promises";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const UA = "Secondwind-data/3 (monthly refresh of repair places; https://github.com/dhanush-satish-reddy/secondwind)";
const STATES = {
  "Baden-Württemberg": "BW", "Bayern": "BY", "Berlin": "BE", "Brandenburg": "BB", "Bremen": "HB", "Hamburg": "HH", "Hessen": "HE",
  "Mecklenburg-Vorpommern": "MV", "Niedersachsen": "NI", "Nordrhein-Westfalen": "NW", "Rheinland-Pfalz": "RP", "Saarland": "SL",
  "Sachsen": "SN", "Sachsen-Anhalt": "ST", "Schleswig-Holstein": "SH", "Thüringen": "TH",
};
const KEEP_TAGS = ["repair", "craft", "shop", "electronics_repair", "service:mobile_phone:repair", "service:bicycle:repair"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, label) {
  const started = Date.now();
  for (let round = 0; Date.now() - started < 35 * 60 * 1000; round++) {
    for (const ep of ENDPOINTS) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 11 * 60 * 1000);
        const res = await fetch(ep, { method: "POST", signal: ctrl.signal, headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) });
        clearTimeout(timer);
        const text = await res.text();
        if (res.ok && text.trim().startsWith("{")) {
          const j = JSON.parse(text);
          if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error("remark: " + j.remark.slice(0, 120));
          console.log(`${label}: ok from ${ep} (${j.elements.length} elements)`);
          return j;
        }
        console.log(`${label}: ${ep} -> HTTP ${res.status}`);
      } catch (e) {
        console.log(`${label}: ${ep} -> ${e.message}`);
      }
      await sleep(30000);
    }
    await sleep(60000);
  }
  throw new Error(label + ": all Overpass servers failed for 35 minutes");
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;

// 1) Postcodes with centre point and state(s)
const plzQuery = `[out:json][timeout:900][maxsize:1073741824];
area["ISO3166-1"="DE"]["admin_level"="2"]->.de;
rel["boundary"="administrative"]["admin_level"="4"](area.de)->.st;
foreach.st->.s(
  .s out tags;
  .s map_to_area->.sa;
  rel["boundary"="postal_code"]["postal_code"](area.sa);
  out center tags;
);`;
const plzData = await overpass(plzQuery, "postcodes");
const plz = {};
let state = null;
for (const el of plzData.elements) {
  if (el.tags && el.tags.admin_level === "4") { state = STATES[el.tags["name:de"] || el.tags.name] || null; continue; }
  const code = el.tags && el.tags.postal_code;
  if (!code || !/^\d{5}$/.test(code) || !el.center) continue;
  if (!plz[code]) plz[code] = [r4(el.center.lat), r4(el.center.lon), []];
  if (state && !plz[code][2].includes(state)) plz[code][2].push(state);
}
const plzCount = Object.keys(plz).length;
if (plzCount < 7000) throw new Error("too few postcodes: " + plzCount);

// 2) Repair places
const placeQuery = `[out:json][timeout:900][maxsize:1073741824];
area["ISO3166-1"="DE"]["admin_level"="2"]->.de;
(
  nwr["repair"="assisted_self_service"](area.de);
  nwr["craft"="electronics_repair"](area.de);
  nwr["shop"~"^(mobile_phone|electronics|appliance|computer|vacuum_cleaner|hifi)$"]["repair"~"yes|only"](area.de);
  nwr["shop"="mobile_phone"]["service:mobile_phone:repair"="yes"](area.de);
  nwr["shop"="bicycle"]["service:bicycle:repair"="yes"](area.de);
);
out center tags;`;
const placeData = await overpass(placeQuery, "places");
const tiles = {};
let placeCount = 0;
for (const el of placeData.elements) {
  const t = el.tags || {};
  if (!t.name) continue;
  const c = el.type === "node" ? { lat: el.lat, lon: el.lon } : el.center;
  if (!c) continue;
  const tags = {};
  for (const k of KEEP_TAGS) if (t[k]) tags[k] = String(t[k]).slice(0, 60);
  const p = {
    n: t.name.slice(0, 120), la: r4(c.lat), lo: r4(c.lon), t: tags,
    s: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ").slice(0, 120) || undefined,
    c: [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" ").slice(0, 80) || undefined,
    h: (t.opening_hours || "").slice(0, 160) || undefined,
    w: (t.website || t["contact:website"] || "").split(/[;\s]/)[0].slice(0, 200) || undefined,
    o: el.type[0] + el.id,
  };
  const key = `${Math.floor(c.lat)}_${Math.floor(c.lon)}`;
  (tiles[key] ||= []).push(p);
  placeCount++;
}
if (placeCount < 500) throw new Error("too few places: " + placeCount);

// 3) Write files
await rm("data/plz", { recursive: true, force: true });
await rm("data/repair", { recursive: true, force: true });
await mkdir("data/plz", { recursive: true });
await mkdir("data/repair", { recursive: true });
for (let d = 0; d <= 9; d++) {
  const part = Object.fromEntries(Object.entries(plz).filter(([k]) => k[0] === String(d)).sort());
  await writeFile(`data/plz/${d}.json`, JSON.stringify(part));
}
for (const [key, list] of Object.entries(tiles)) await writeFile(`data/repair/${key}.json`, JSON.stringify(list));
await writeFile("data/meta.json", JSON.stringify({
  updated: new Date().toISOString().slice(0, 10), postcodes: plzCount, places: placeCount, tiles: Object.keys(tiles).sort(),
  attribution: "© OpenStreetMap contributors, ODbL 1.0 – https://www.openstreetmap.org/copyright",
}, null, 1));
console.log(`done: ${plzCount} postcodes, ${placeCount} places, ${Object.keys(tiles).length} tiles`);
