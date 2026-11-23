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
  for (let round = 0; Date.now() - started < 20 * 60 * 1000; round++) {
    for (const ep of ENDPOINTS) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4 * 60 * 1000);
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
      await sleep(15000);
    }
    await sleep(30000);
  }
  throw new Error(label + ": all Overpass servers failed for 20 minutes");
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;

// One small request per state (busy public servers accept these much more readily than one request for all of Germany)
const tiles = {};
const plz = {};
let placeCount = 0;
const seenPlace = new Set();
for (const [stateName, code] of Object.entries(STATES)) {
  const query = `[out:json][timeout:180];
area["ISO3166-2"="DE-${code}"]["admin_level"="4"]->.s;
rel["boundary"="postal_code"]["postal_code"](area.s);
out center tags;
(
  nwr["repair"="assisted_self_service"](area.s);
  nwr["craft"="electronics_repair"](area.s);
  nwr["shop"~"^(mobile_phone|electronics|appliance|computer|vacuum_cleaner|hifi)$"]["repair"~"yes|only"](area.s);
  nwr["shop"="mobile_phone"]["service:mobile_phone:repair"="yes"](area.s);
  nwr["shop"="bicycle"]["service:bicycle:repair"="yes"](area.s);
);
out center tags;`;
  const data = await overpass(query, stateName);
  let nPlz = 0, nPlaces = 0;
  for (const el of data.elements) {
    const t = el.tags || {};
    if (t.boundary === "postal_code") {
      const pc = t.postal_code;
      if (!pc || !/^\d{5}$/.test(pc) || !el.center) continue;
      if (!plz[pc]) plz[pc] = [r4(el.center.lat), r4(el.center.lon), []];
      if (!plz[pc][2].includes(code)) plz[pc][2].push(code);
      nPlz++;
      continue;
    }
    if (!t.name) continue;
    const id = el.type[0] + el.id;
    if (seenPlace.has(id)) continue;
    const c = el.type === "node" ? { lat: el.lat, lon: el.lon } : el.center;
    if (!c) continue;
    seenPlace.add(id);
    const tags = {};
    for (const k of KEEP_TAGS) if (t[k]) tags[k] = String(t[k]).slice(0, 60);
    const p = {
      n: t.name.slice(0, 120), la: r4(c.lat), lo: r4(c.lon), t: tags,
      s: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ").slice(0, 120) || undefined,
      c: [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" ").slice(0, 80) || undefined,
      h: (t.opening_hours || "").slice(0, 160) || undefined,
      w: (t.website || t["contact:website"] || "").split(/[;\s]/)[0].slice(0, 200) || undefined,
      o: id,
    };
    (tiles[`${Math.floor(c.lat)}_${Math.floor(c.lon)}`] ||= []).push(p);
    placeCount++; nPlaces++;
  }
  console.log(`${stateName}: ${nPlz} postcodes, ${nPlaces} places`);
  await sleep(5000);
}
const plzCount = Object.keys(plz).length;
if (plzCount < 7000) throw new Error("too few postcodes: " + plzCount);
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
