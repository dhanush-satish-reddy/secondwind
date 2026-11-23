# Secondwind

**Reparieren statt wegwerfen. Mit Recht.** · *Your stuff deserves a second wind.*

Secondwind is a free, mobile-first helper (DE/EN) for using the EU Right to Repair in Germany (Directive (EU) 2024/1799, in force in Germany since 31 July 2026). It works like an app: one screen per step, and it can be added to the iPhone home screen.

## What it does (v3)
1. **Rechte prüfen / Check my rights** – tap the device, purchase date, where and how it broke. You see one clear answer (seller warranty §§ 437, 439 BGB, manufacturer repair § 479b BGB, or no claim) and only the cards that fit your case. Details, sources and alternatives are folded away.
2. **Brief erstellen / Write the letter** – pick the shop or brand from the company list (`companies.json`, 35 hand-checked companies, each with its official source and check date). The recipient, the repair/price link and the letter fill in. Change the company at any time, even from the finished letter or the follow-up: everything updates, and nothing you typed yourself is replaced without asking.
   - **Company not in the list?** The Worker reads the address from the company's own Impressum page. It is shown as "nicht geprüft" until you confirm it. Nothing is ever invented: if no address is found, the app says so and tells you where to look.
   - **Any language:** describe the defect in your language and get a short German sentence to check.
3. **Nachfassen / Follow up** – second letter if there's no answer, a refusal, or the repair failed – plus who helps next.
4. **Wo reparieren? / Where to repair** – enter your postcode: repair cafés and repair shops nearby from OpenStreetMap, filtered to your device. The repair bonus is shown only if your postcode is in a state that has one.

The page stores nothing, sets no cookies and has no tracking. See "Datenschutz" in the app's Info screen for exactly what is sent where.

## Files
- `index.html` – the whole app (single file)
- `companies.json` – company list. Edit this file to add or fix a company; no code changes needed. Every entry needs `source` (official page) and `checked` (date).
- `manifest.json`, `icon.svg`, `icon-180.png`, `icon-512.png` – home-screen app icon
- `worker/` – the only backend (Cloudflare Worker)

## Backend (Cloudflare Worker in `worker/`)
- `POST /translate` – defect text → short German sentence (Workers AI)
- `GET /repair?plz=…&dev=…` – repair places from OpenStreetMap (Overpass API), cached per postcode
- `POST /company` – company address from its Impressum (optional web search via Groq if the `GROQ_API_KEY` secret is set; otherwise Wikidata or the website the user pastes)
- Abuse protection: only requests from the GitHub Pages site, rate limits (5 / 10 / 3 per minute), length limits, off-topic refusal, no internal web addresses, logs off, nothing stored.
- Tests: `cd worker && npm test` (no account or internet needed)

## Data and credits
- Repair places: © OpenStreetMap contributors, ODbL
- Company addresses: official company websites (source and date per entry)

## Disclaimer
Secondwind gives general information, not legal advice. Legal status as of 23 Nov 2026.
