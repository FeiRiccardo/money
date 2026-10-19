# Money Tracker

A simple personal money and expense tracker for one person. It runs in the browser as an installable web app (PWA), keeps all data on the device, and backs up through CSV files or one full ZIP (with settings and receipt photos). It also has charts, receipt photos and a printable monthly report.

**Open the app: https://feiriccardo.github.io/money/**

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

## Google Drive backup (optional)

The app can keep its Full backup in a hidden app folder of the user's own Google Drive ([SPEC section 14](SPEC.md#14-google-drive-backup)). It is free and needs no server. It is switched on by setting a Google OAuth client ID at build time; without one the Drive rows are hidden.

One-time setup in the [Google Cloud console](https://console.cloud.google.com/):

1. Create a project (no billing account needed).
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **Google Auth Platform → Branding**: app name, support email. **Audience**: External. **Data access**: add the scope `https://www.googleapis.com/auth/drive.appdata` (it only reaches the app's hidden folder).
4. **Clients → Create client → Web application**:
   - Authorised JavaScript origins: `https://feiriccardo.github.io` and `http://localhost:5173`
   - Authorised redirect URIs: `https://feiriccardo.github.io/money-tracker/` and `http://localhost:5173/` (exactly, with the trailing slash)
5. Copy the client ID (it is public, not a secret).
6. GitHub repo → **Settings → Secrets and variables → Actions → Variables**: add `GOOGLE_CLIENT_ID`. The deploy workflow passes it to the build.
7. Locally: create `.env.local` with `VITE_GOOGLE_CLIENT_ID=<the id>` and run `npm run dev`.

While the app is in **Testing** on the Audience page, only the test users listed there can connect. **Publish app** to let anyone use it.

Limits: a static site gets only short-lived Google tokens, so after about an hour automatic saving pauses and Settings offers "Reconnect" (one tap). The browser tests fake Google and Drive (`src/data/fakeDrive.ts`), so the real sign-in has to be checked by hand, including on an installed iPhone app.

## License

[MIT](LICENSE), copyright (c) 2026 Riccardo Fei.
