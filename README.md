# Money Tracker

A simple personal money and expense tracker for one person. It runs in the browser as an installable web app (PWA), keeps all data on the device, and backs up through CSV files or one full ZIP (with settings and receipt photos). It also has charts, receipt photos and a printable monthly report.

**Open the app: https://feiriccardo.github.io/money-tracker/**

On a phone, open the link and use "Add to Home Screen" (iOS) or "Install" (Android) so it works like a normal app and the browser does not erase its data.

The product is specified in [`SPEC.md`](SPEC.md); the vocabulary is in [`CONTEXT.md`](CONTEXT.md); the reasoning behind each decision is in [`.wayfinder/`](.wayfinder/map.md).

## Run it

```bash
npm install
npm run dev        # development server
npm run build      # type-check, then production build into dist/
npm run preview    # serve the production build (needed for install / offline)
```

## Test it

```bash
npm test                          # unit tests (Vitest)
npx playwright install chromium   # once
npm run test:e2e                  # browser tests (Playwright; builds and serves the app)
```

## Layout

- `src/domain/` pure rules, no browser APIs: amount parsing, Category name rules, month summary, search/filter/sort, recurring schedules, CSV and ZIP backup, chart data, the monthly report, reminders. Tested at their public interfaces.
- `src/data/ledger.ts` the one data-access module over IndexedDB (`idb`). Tested against `fake-indexeddb`.
- `src/app/` React screens and the store that wraps the Ledger.
- `src/i18n/` English and Italian strings (starter Category names are translated while they are still defaults).
- `e2e/` the main user flows in a real browser.

## Hosting

Static files only. Upload `dist/` to any HTTPS static host (Cloudflare Pages, GitHub Pages). HTTPS is required for install, offline use and storage persistence.

## License

[MIT](LICENSE), copyright (c) 2026 Riccardo Fei.
