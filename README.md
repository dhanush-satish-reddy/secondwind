# Secondwind

**Reparieren statt wegwerfen. Mit Recht.** · *Your stuff deserves a second wind.*

Secondwind is a free, mobile-first helper (DE/EN) for using the EU Right to Repair in Germany (Directive (EU) 2024/1799, in force in Germany since 31 July 2026).

## What it does (v2)
1. **Rechte prüfen / Check my rights:** tells you whether the seller's legal warranty (§§ 437, 439 BGB) or the manufacturer's repair obligation (§ 479b BGB) applies. Warns on the last day of the 2 years.
2. **Brief erstellen / Write the letter:** ready-to-send German letter to the seller or manufacturer.
   - **Manufacturer finder:** pick one of 17 brands and the recipient address fills in (hand-checked on the official websites, 23 Nov 2026), with a link to the brand's repair/price page.
   - **Any language:** describe the defect in your language, get a short German sentence to check and approve (optional, needs the Worker below).
   - **Calendar:** add the reply deadline to your phone's calendar.
3. **Nachfassen / Follow up:** second letter if the seller or manufacturer doesn't answer, refuses, or the repair failed – plus who helps next (Verbraucherzentrale, Universalschlichtungsstelle, EVZ).
4. **Wo reparieren? / Where to repair:** repair cafés, iFixit, EVZ and the regional repair bonus status.

The page is a single `index.html`. It stores nothing and has no tracking. The only data that ever leaves the browser is the defect text, and only when the user taps "Auf Deutsch formulieren lassen".

## Hosting
- Page: GitHub Pages → Settings → Pages → Deploy from branch → `main` / root.
- Translation backend: Cloudflare Worker in `worker/` (Workers AI free allowance, max 5 requests per minute per visitor, only accepts requests from the GitHub Pages site, logs off, nothing stored).
  Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → `secondwind` → root directory `worker`.
  If the Worker is not deployed, the page still works; the translate button just reports that translation isn't available.
- Worker tests: `cd worker && npm test`

## Disclaimer
Secondwind gives general information, not legal advice. Legal status as of 23 Nov 2026. Sources are listed in the page footer.
