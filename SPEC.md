# Money Tracker v1: product spec

A simple personal money and expense tracker for one person with no accounting knowledge. The user records Expenses and Income, sorts them into Categories, and sees their Balance and a monthly summary. It runs as a mobile-first web app (PWA), keeps all data on the device, and backs up through CSV files.

This spec is compiled from the Wayfinder map in `.wayfinder/`. Every section names the ticket that holds the full reasoning. Where something was decided by Claude under the owner's delegation, or is an assumption nobody confirmed, it is listed in [section 11](#11-open-items-assumptions-and-delegated-decisions). Vocabulary is defined in `CONTEXT.md`; capitalised terms below (Transaction, Category and so on) are those terms.

## 1. Scope

**In v1**
- One person tracking personal money. No accounting knowledge assumed.
- Manual entry of Expenses and Income, each with one or more Categories, an amount, a date and an optional note.
- User-editable flat Categories, with separate lists for Expenses and Income.
- A Transactions list, an all-time Balance, and a monthly summary.
- Search and filter across all Transactions, with a choice of ordering.
- Recurring Transactions (weekly, monthly or yearly), created automatically when the app opens.
- Quick entry helpers: Duplicate a Transaction, and a Recent strip in the add form.
- Local-only storage on the device, with CSV export and import.
- Charts, receipt photos, a printable monthly report and a full ZIP backup (see [section 13](#13-additions-after-v1)).
- One Currency, EUR. English and Italian UI, selectable.

**Out of scope for v1**
- Sync, accounts, bank connections, receipt scanning or OCR.
- Budgets.
- Multiple accounts or wallets, multiple Currencies, shared or household use.
- Sub-categories and merging Categories.
- Merge-style import.

## 2. Domain model

See `CONTEXT.md` for the glossary. In short:

- **Transaction**: one recorded movement of money, an **Expense** (money out) or **Income** (money in). It carries one or more Categories or Retired labels.
- **Category**: a flat, user-editable label. Expense and Income each have their own list. A Transaction's full amount counts toward each of its Categories.
- **Retired label**: the frozen name of a deleted Category, kept as plain text on the Transactions that had it.
- **Balance**: Opening balance plus all Income minus all Expenses, over all time.
- **Opening balance**: a setting, may be negative, not part of the backup.
- **Currency**: EUR, fixed.

## 3. Data model

*Fields and rules below come from the decisions. Where a storage shape is not stated by a ticket, it is marked as a recommendation.*

**Transaction**
- `date`: a calendar date with no time of day (`YYYY-MM-DD`), future dates allowed.
- `type`: expense or income.
- `amount`: greater than zero, at most 2 decimals, always positive (the type gives the direction). *Recommendation: store as integer cents to avoid floating-point errors.*
- Categories: one or more entries. Each entry is either a reference to a live Category or a Retired label (frozen text). At least one entry is always present.
- `note`: optional text.
- `createdAt`: when it was recorded; used only to order Transactions on the same date (later-recorded first). Added after v1, so older Transactions may lack it.
- `ruleId`: set when a recurring rule created the Transaction or it was made the first occurrence of one. It is not exported.

**Category**
- `type` (expense or income), `name`, and an optional `defaultKey` that is set only while the Category is a still-translatable starter default.
- Names are unique within a type (case-insensitive, trimmed), at most 30 characters, and must not contain `|`. The same name may exist in both lists.
- *Recommendation: store a `lastUsedAt` per Category to drive the picker ordering.*
- A renamed starter default loses its `defaultKey` and becomes a plain custom Category.

**Retired label**
- Created when a Category is deleted. It keeps the Category's name as displayed at that moment, in the language active then, and never changes afterwards (it does not translate).
- It is not a Category: it never appears in the entry picker or the Categories screen.
- It can be removed from a Transaction but never re-added.
- It reserves its name: a Category with the same name in that type cannot be created or renamed to. *Derived consequence: the reservation lasts as long as at least one Transaction still carries the label.*

**Recurring rule**
- The same content as a Transaction (`type`, `amount`, Categories or Retired labels, `note`) plus `frequency` (weekly, monthly or yearly), `startDate`, an optional `endDate`, and `nextDate`, the next occurrence not yet created.
- Monthly and yearly rules keep the day of the month of `startDate`; in a shorter month they use its last day (a rule starting on the 31st uses Feb 28, then goes back to Mar 31). A yearly rule starting on Feb 29 uses Feb 28 in other years.
- A deleted Category is replaced on a rule by a Retired label, exactly as on Transactions, and a label carried only by a rule still reserves its name.
- Stored in its own IndexedDB store. The database schema version is now 2; opening a version-1 database adds the store and leaves every existing record untouched.

**Settings** (device-level, stored separately from Transactions, never exported)
- Language (English default), Opening balance (default 0.00), plus bookkeeping for reminders: last-backed-up time, change count since last backup, banner dismissal times, and the chosen sort order for Transaction lists (newest first by default).

**Starter Categories**
- Expense: Groceries, Dining out, Transport, Housing, Utilities, Health, Entertainment, Shopping, Other.
- Income: Salary, Gifts, Other.
- Stored with a `defaultKey` and shown in the current language. "Other" has no special protection. Italian names are written at build time.

Source tickets: *Category lifecycle*, *Transaction entry flow*, *Settings screen and first-run experience*.

## 4. Screens and flows

The home screen is **variant A, Ledger list**. A runnable reference lives at `.wayfinder/prototypes/home-screen/index.html` (variant A is the default; it is a throwaway prototype with fake data, so use it for look and behaviour only, not as code). Source ticket: *Home screen prototype*.

### 4.1 Home screen

- Header: a month switcher (previous and next arrows around the month name) above a large **Balance** figure, with a gear icon at the right of the Balance row that opens Settings.
- Two tabs: **Transactions** and **Summary**. A floating "+" button opens the add form.
- **Transactions tab:** a list grouped by day, newest first. Each day header shows that day's net amount. Each row shows the note (or the first Category if there is no note), the Category chips (Retired labels greyed with a dashed outline), and the signed amount (green plus for Income, red minus for Expenses). Tapping a row opens the edit form.
- **Banners** appear as the first item of the Transactions tab, one at a time. The iOS install nudge takes priority over the backup reminder (see section 7).
- **Summary tab:** see section 5.

### 4.2 Add, edit and delete a Transaction

- "+" opens one full-screen form. An Expense/Income toggle sits at the top, Expense by default.
- Amount is the first field and takes focus with the numeric keypad open. Defaults: type Expense, date today, no Categories selected, empty note.
- Categories are tappable chips showing only the Categories of the chosen type, any number selectable, ordered by most recently used. A "+ New" chip creates a Category inline. Switching type clears the selection.
- **At least one Category (or Retired label) is required.** Save stays disabled until an amount and a Category are present.
- Amount: greater than zero, at most 2 decimals, both `,` and `.` accepted as the decimal separator whatever the language, no maximum. Future dates are allowed.
- After Save the app returns to the list with the new Transaction visible at its date position (switching to that month if needed).
- Edit: tap a row to open the same form pre-filled. A Transaction's Retired labels appear as selected, greyed chips that can be removed but not re-added.
- Delete: only inside the edit form. It deletes immediately and shows an Undo toast for about 5 seconds. There is no confirmation dialog and no edit history.

### 4.3 Categories screen

- Reached from Settings. An Expense/Income toggle at the top, then an alphabetical list for the chosen type.
- Tapping a row opens a rename dialog with a Delete button. A "+ New category" button sits at the bottom.
- The dialog enforces the name rules from section 3 and refuses names reserved by a Retired label with a message.
- **Delete** shows how many Transactions use the Category, then removes it and replaces it on those Transactions with a Retired label, with a short Undo toast. Any Category may be deleted, including the last one of a type; with an empty list the entry picker shows only "+ New".

### 4.4 Settings

Opened by the gear icon; a back arrow returns home. One scrolling screen of grouped rows, in this order:

1. **Language:** English or Italian, English by default. Applies immediately with no reload, including translatable default Category names. Dates and numbers follow the language's formatting. A device setting: not in the backup, unchanged by an import.
2. **Opening balance:** one amount edited through a small dialog; negative values allowed, at most 2 decimals, both `,` and `.` accepted, default 0.00. Changing it updates the Balance immediately. No date, no history.
3. **Categories:** opens the Categories screen.
4. **Backup:** Export, Import, last-backed-up date, and a reminder that the Opening balance is not in the files.
5. **Storage and install:** storage status ("protected" or "not guaranteed", with one line of explanation) and an "Install app" row on Android and desktop.
6. **Erase all data:** needs a clear confirmation saying the data cannot be recovered, recommends exporting first and offers the export right there. Afterwards the app returns to the first-run screen.
7. Footer: the app version and "Your data stays on this device."

### 4.5 First-run screen

- Shown whenever the database is empty (the app cannot tell "never used" from "erased by the browser"). It shows the app name, a line saying the data stays on this device, English and Italiano chips (English preselected), and two buttons side by side: **Start fresh** and **Restore from backup**.
- **Start fresh** goes to one skippable step, "Starting balance (optional)" (an amount field and a Skip button), then opens the home screen with the starter Categories already in place and no commentary about them.
- **Restore from backup** opens the import flow (section 6), followed by the opening-balance check.

### 4.6 Empty states

- No Transactions at all: "Nothing here yet. Tap + to add your first expense or income."
- An empty month while other months have data: "No Transactions this month. Tap + to add one." The month switcher keeps working.
- Summary tab, empty month: "Add a Transaction to see this month's summary."

### 4.7 Search, filter and sort

- A magnifier next to the gear opens a **Search screen over all months** (the month switcher does not apply there).
- Text search ignores upper and lower case and accents ("caffe" finds "Caffè"). Every word must match, in the note, a Category name or a Retired label. If the whole text is a number (`12,50` or `12.5`), Transactions with exactly that amount also match.
- Filters, combined with AND: **type** (All, Expenses, Income); **Categories** (one or more, a Transaction matches if it has any of them; Retired labels can be chosen too); **date range** (All time, This month, Last month, This year, or Custom From and To, inclusive, either end may be empty).
- A results line shows the count and the **real net** of the results, calculated from the Transactions themselves, so the overlapping-Categories caveat of the summary does not apply. "Clear filters" resets everything.
- **Sort** has four options: Newest first (default), Oldest first, Largest amount, Smallest amount. Within one day, the later-recorded Transaction comes first. The same control sits on the Search screen and on the Transactions tab, and the choice is remembered on the device. Date sorts keep the day headers on the home list; amount sorts show one flat list with each row's date.

### 4.8 Recurring Transactions

- **Creating:** the add form has a **Repeat** row (Never, Weekly, Monthly, Yearly) and, when a frequency is chosen, an optional end date. The date in the form is the first occurrence. Setting Repeat on an existing ordinary Transaction makes it the first occurrence of a new rule; it is not duplicated and the next occurrence is the following period.
- **When Transactions are created:** automatically, when the app opens and whenever it returns to the foreground, never in advance. Every occurrence due up to and including today becomes an ordinary Transaction (editable and deletable like any other), including ones missed while the app was closed, and a message says how many were added with one **Undo** for the whole batch. A new rule whose first date is in the past back-fills immediately in the same way.
- Generated Transactions carry a small ↻ mark. In the edit form a Transaction made by a rule shows "↻ Repeats monthly" with **Edit rule** and **Stop repeating**, and no Repeat picker.
- **Managing:** Settings has a **Recurring** screen listing every rule (note or first Category, amount, frequency, next date, or "Ended"). Tapping one edits amount, note, Categories, frequency and end date, or stops it. Edits to a rule affect future Transactions only; editing one generated Transaction changes only that one.
- **Stopping** keeps every Transaction already created and removes their ↻ mark.
- The app can only create Transactions while it is open. If it is not opened for a month, they are created, back-dated correctly, the next time it is.

### 4.9 Quick entry

- **Duplicate:** a button in the edit form opens a new add form pre-filled with that Transaction's type, amount, Categories and note, dated today. Nothing is saved until Save. Retired labels are never copied, so if a Transaction had only Retired labels, a Category must be chosen first.
- **Recent:** in the add form, up to five of the last different Transactions (same type, amount, note and Categories) appear as one-tap chips that fill the form the same way.

### 4.10 Toast messages

Every operation that changes or exports data confirms itself with a short toast, in the chosen language.

| Operation | Message (English) | Undo |
|---|---|---|
| Transaction added | "Added · Coffee · €4.50" | removes it (not offered when Repeat was chosen) |
| Transaction edited | "Updated · Coffee · €6.00" | puts the old values back (not offered when Repeat was chosen) |
| Transaction deleted | "Deleted · Coffee · €4.50" | restores it |
| Repeat chosen | "Repeats weekly: Bus pass" (info) | none |
| Recurring Transactions created | "2 recurring Transactions added" | removes exactly that batch |
| Recurring rule edited | "Recurring Transaction updated: Bus pass" | none |
| Recurring rule stopped | "Stopped repeating: Bus pass" | none (a confirmation dialog comes first) |
| Category created, renamed | "Category “Gym” created", "Category renamed to “Fitness”" | none |
| Category deleted | "Category “Fitness” deleted" | restores it and its Retired labels |
| Opening balance saved | "Opening balance saved" | none |
| Backup exported | "Backup saved. Keep the files somewhere outside the browser." | none |
| Backup imported | "Backup imported" | restores everything as it was |
| All data erased | "All data erased" | none (a confirmation dialog comes first) |

- The text of a Transaction message is its note, or its first Category when it has no note, then the amount.
- **No toast** for changes you can see happen: sort order, month, tabs, filters, language, banner dismissal.
- **Behaviour:** up to three at once, newest at the bottom. A toast with an Undo, and an error, stays 6 seconds; any other 3 seconds. A fourth toast pushes out the oldest one that has no Undo (if all three have one, the oldest). Holding, hovering or focusing a toast pauses its timer, and its ✕ button dismisses it. They sit above the + button and above a form's Save bar, never over either.
- **Kinds:** success (✓), info (i) and error (!, red). Success and info are announced politely to screen readers, errors urgently.
- **Errors:** a failed export is a red toast. A failed write keeps the blocking "Not saved, back up now" dialog, because data is at risk.

## 5. Monthly summary

- The summary covers the month shown in the header. Months are determined by the Transaction's date.
- It shows the **real month totals**: Income, Expenses and Net.
- Below, **Expenses by Category** and **Income by Category** as bars with a Transaction count, largest first. A Retired label is its own line, tagged "retired".
- Because a Transaction counts in full toward each of its Categories, these lines can add up to more than the real total. The screen says so in a visible line ("Categories overlap: a Transaction counts in each of its Categories, so these lines add up to more than the real total above"). There are no pie charts and no percentages that imply the parts sum to 100%.
- Balance (header) is all-time and independent of the month shown.

Source tickets: *Home screen prototype*; premises in `.wayfinder/map.md`.

## 6. Import and export

Two CSV files, plus a third when there are recurring rules, in a fixed dialect whatever the UI language: comma delimiter, dot decimal, UTF-8 (with a byte-order mark so spreadsheets read accents), dates as ISO `YYYY-MM-DD`. The plain backup is CSV; a ZIP that adds the settings and receipt photos is described in section 13. Source ticket: *Import and export rules*.

**`transactions.csv`** columns: `date`, `type` (`expense` or `income`), `amount` (positive), `categories`, `note`. Several Categories in one cell are separated by `|`. There is no `id` column.

**`categories.csv`** columns: `type`, `name`, `default_key`. `default_key` is blank for a custom Category and set (for example `groceries`) for a still-translatable starter default.

**`recurring.csv`** (written only when there is at least one rule; optional on import) columns: `type`, `amount` (positive), `categories` (separated by `|`), `note`, `frequency` (`weekly`, `monthly` or `yearly`), `start_date`, `end_date` (blank if none), `next_date`. `next_date` is what prevents duplicates after a restore: nothing is created before that date. A blank `next_date` is read as the start date. The link between a rule and the Transactions it made is not exported, so after a restore older generated Transactions lose their ↻ mark but nothing is duplicated. Rows are validated like the others (type, amount, frequency, real dates, end date not before start date, at least one Category name); bad rows are skipped and listed.

**Retired labels** have no row in `categories.csv`. They appear only as names in a Transaction's `categories` cell. On import, any name in a Transaction that is not in the categories list becomes a Retired label.

**Export:** all history, no filters. Transactions are listed by date, and within a day by when they were recorded, so a same-day order survives a restore. File names carry the date (`transactions-2026-10-18.csv`, `categories-2026-10-18.csv`, and `recurring-2026-10-18.csv` when there are rules). On a phone, use the share sheet (Web Share API) with all the files when supported, so they land in Files, iCloud Drive or Google Drive; otherwise fall back to separate downloads.

**Import:** one mode only, **replace everything**. The user selects the files together: Transactions and Categories are required, Recurring is optional (a backup without it restores with no rules, and restoring replaces any existing rules). A preview shows counts (rows to import, rows with errors) and requires an explicit confirmation that tells them to export first. Validation reuses the entry rules: amount greater than zero with at most 2 decimals, a valid ISO date, a `type` of expense or income, and at least one name in `categories`. Invalid rows are skipped and listed in the preview with a row number and a reason; the user can import the valid rows or cancel. A short-lived Undo for the whole import is included (see section 11). Settings (language, Opening balance) are neither read nor changed by an import. After a successful import the app shows a one-time "Check your opening balance" step with the current value editable and a line saying it is not stored in the backup files.

## 7. Backup reminders and storage durability

Browser-local storage can be erased (Safari tabs delete all site data after 7 days without use; the user can clear site data; the browser can evict under pressure). Backup is therefore a core feature, not a footnote. Source tickets: *Local PWA storage reliability* (research file in `.wayfinder/research/`), *Backup and restore experience*.

- **Backup reminder banner:** shown when there is at least one unbacked change and either 7 days have passed since the last backup or 20 changes have piled up. A user who has never backed up sees it after their 5th Transaction. It reads "N changes not backed up" with a "Back up now" button that starts the export. Dismissing hides it for 3 days.
- **"Last backed up"** is recorded when the share sheet completes or the downloads start. The UI states plainly that the user must keep the files somewhere outside the browser, because the app cannot verify they were saved.
- **iOS install nudge:** on iOS, in a Safari tab and not installed, a banner appears after the first Transaction is saved (never on first load). It says data in a browser tab can be erased after 7 days of inactivity and gives the steps "Share, then Add to Home Screen". Dismissing hides it for 7 days, and it returns while the user stays in a tab. Installed Home Screen apps are exempt from the 7-day cap. On Android and desktop there is no banner, only the "Install app" row in Settings.
- **Persistence:** request `navigator.storage.persist()` on the first Save tap (a user gesture) and never prompt again unprompted; re-check at startup. It is only a request: Safari decides by undocumented heuristics and nothing protects against the user clearing site data. Settings shows the outcome.
- **Failed writes** (for example a quota error): a blocking message that the Transaction was not saved, telling the user to back up now.
- **Erased database:** handled by the first-run screen always offering "Restore from backup" (section 4.5).

## 8. Languages

English (default) and Italian, selectable in Settings, switching immediately. Strings live in one JSON file per language. Starter Category names are stored as keys and translated at display; a renamed Category stops translating. Number and date formatting use the browser's `Intl` APIs. Amount entry is language-independent (accepts `,` and `.`). The export dialect is fixed and does not follow the language.

## 9. Technology

Source ticket: *Tech stack*. The owner is one person plus an agent, so the spec favours mainstream tools, small dependencies and plain code over cleverness.

- **Language and UI:** strict TypeScript with React (Svelte was the runner-up).
- **Build and PWA:** Vite with `vite-plugin-pwa` (manifest, service worker, offline use). Static files only: no server, no backend.
- **Storage:** IndexedDB through the thin `idb` wrapper, behind **one small data-access module** of plain functions: add, edit and delete a Transaction; create, rename and delete a Category; query a month; export and import. The rest of the app never touches IndexedDB directly.
- **Strings:** `i18next` with `react-i18next`, one JSON file per language.
- **Testing:** Vitest unit tests for the pure logic (amount parser; CSV export and import with validation; summary calculations with overlapping Categories and Retired labels; reminder rules). A small set of Playwright tests for the main flows: add, edit, delete with Undo, export, import. No further UI test suite in v1.
- **Hosting:** static hosting over HTTPS (required for the service worker, `persist()` and install). Cloudflare Pages or GitHub Pages, whichever the owner already uses; avoid any host that needs a server.

## 10. Acceptance checks (the behaviours most likely to be got wrong)

1. Adding a Transaction with two Categories makes its full amount appear in both Category lines of the Summary, while the real month total counts it once.
2. Save is disabled until the amount is valid and at least one Category (or Retired label) is selected.
3. Typing `12,5` and `12.50` both save 12.50.
4. Deleting a Category keeps its name on old Transactions as a greyed Retired label, still counted in the Summary, and a new Category with that name is refused.
5. Deleting a Transaction removes it at once and Undo within about 5 seconds restores it.
6. Switching language changes starter Category names but not renamed ones or Retired labels.
7. Export then Import round-trips Transactions, Categories, starter-default keys and Retired labels; Opening balance and language are unchanged by the import and the opening-balance check is shown.
8. An import with invalid rows lists them with row numbers and lets the user import the rest or cancel.
9. With an empty database the first-run screen offers both Start fresh and Restore from backup.
10. The backup banner follows the rule in section 7, and dismissing it hides it for 3 days.
11. Searching "CAFFE" finds a Transaction noted "Caffè al bar"; searching `12,50` finds a €12.50 Transaction.
12. Category filter keeps a Transaction that has any one of the chosen Categories (or Retired labels); a date range includes both end dates.
13. Sorting by Largest or Smallest amount shows one flat list; Newest and Oldest keep day headers; the choice survives a reload.
14. A monthly rule starting on Jan 31 creates Jan 31, Feb 28 and Mar 31 (not Mar 3), and a rule never creates the same occurrence twice.
15. Repeat weekly on a date 14 days ago creates the two later occurrences at once, with one Undo that removes exactly those.
16. Stopping a rule keeps all its Transactions and removes the ↻ marks.
17. Duplicate and Recent pre-fill the form with today's date and never copy a Retired label.
18. A backup with rules has a third file; restoring it brings the rules back with their `next_date`; restoring only the two older files works and leaves no rules.
19. A database written by the first version opens with all its Transactions and settings intact.
20. Adding, editing and deleting a Transaction each show their toast with the amount; Undo on an add removes it, on an edit restores the old values, and neither leaves the backup reminder's change count higher than before.
21. Four quick toasts show only the newest three; a toast under the pointer does not expire until the pointer leaves; the ✕ dismisses one at once.
22. A plain toast disappears after about 3 seconds and one with an Undo after about 6.
23. A toast never covers the Save button or the + button, at 320x568, 390x844 and landscape phone sizes.
24. A failed export shows a red error toast, not a success toast.

## 11. Open items, assumptions and delegated decisions

Check these before building; each is also recorded in the named ticket.

- **Backup and restore experience was decided by Claude, not answered by the owner.** The owner delegated ("decide, starting from the design I selected"). The reminder thresholds (7 days, 20 changes, 5 Transactions), banner priority and dismissal times, share-sheet export, and the after-import opening-balance step are therefore Claude's recommendations and open to change.
- **Retired label name reuse.** The owner answered "not possible same name"; it was read literally, so a deleted Category's name stays reserved and cannot be reused while any Transaction carries it. This may annoy users (delete "Gym", never recreate it). Confirm or relax.
- **Import extras not explicitly asked for:** a short-lived Undo for a whole import, and requiring both CSV files together.
- **Fixed CSV dialect.** An Italian-locale Excel may open the comma-delimited file as one column; Google Sheets and Excel's text-import work. A known rough edge, accepted when the owner chose "always the same dialect".
- **Opening balance is not in the backup.** After restoring on a new device the user must re-check it, hence the post-import step.
- **Home screen coverage.** The owner chose variant A with the single comment "I like the first design". The prototype was only syntax-checked, not exercised end to end. Not covered: Summary edge cases (ties, one very large Category) and the final look of Settings, the Categories screen and first-run, which were specified in words, not prototyped.
- **Settings Categories list is alphabetical** (an assumption stated in the Category lifecycle ticket, then carried into the Categories screen).
- **Storage research gaps:** Safari's `persist()` heuristics are undocumented, the 7-day cap is documented on WebKit's tracking-prevention page but not repeated in the 2023 storage post, and no primary source covers iOS Home Screen app data when the app is deleted (assume lost).
- **Recurring, search and quick entry were added after v1.** The owner chose them ("all recommended") from Claude's list; decisions Q1 to Q13 of that round are written into sections 4.7 to 4.9 and 6. A trend chart was explicitly declined.
- **The third backup file is written only when rules exist.** The decision said "Export adds a third file"; writing an empty file for users with no rules only adds a download on a phone and restores identically, so it was left out. Say so if you want it always.
- **Back-fill can surprise.** Creating a rule with a first date far in the past creates every occurrence since then straight away (with one Undo). That follows the decision but is easy to do by accident with a wrong date.
- **Recurring only runs while the app is opened.** There is no background job on a static site.
- **Tie-breaking uses a `createdAt` field added later.** Transactions recorded before it existed have no value and sort after newer ones on the same date.
- **Toasts replaced the single toast.** Older code showed one toast at a time, so a new one hid the previous Undo; they now stack (decisions Q1 to Q6 of the toast round, all taken as recommended). Undo for an add or edit is deliberately not offered when Repeat was chosen, because that creates a rule and a batch with their own Undo.
- **Hosting is left to the owner** (Cloudflare Pages or GitHub Pages).
- **Italian translations** of the starter Category names and all UI strings are to be written at build time.

## 12. Where the reasoning lives

- Map and decision index: `.wayfinder/map.md`
- Vocabulary: `CONTEXT.md`
- Tickets with full resolutions: `.wayfinder/tickets/` (storage reliability, transaction entry flow, Category lifecycle, import and export rules, home screen prototype, backup and restore experience, tech stack, settings and first run)
- Storage research with sources: `.wayfinder/research/01-local-pwa-storage-reliability.md`
- Home screen reference prototype: `.wayfinder/prototypes/home-screen/index.html`

## 13. Additions after v1

Added after the first release. They keep the local-only promise: nothing here leaves the device unless the user exports it.

**Charts page** (a bar icon in the Home header). It opens on the month being viewed on Home and has its own month controls: previous, next and a month picker (future months are not offered by the picker). It shows:
- *Income and expenses*: one pair of bars (income, expenses) per month for the last 6 or 12 months ending at the chosen month, drawn as plain SVG. Empty months are zero.
- *By Category*: a donut for the chosen month, for Expenses or Income. The five biggest Categories get their own colour and the rest are folded into one grey "Other" slice. Categories overlap (a Transaction counts in full under each of its Categories), so the shares are of the Category lines, not of the real total.
- *Compared with last month*: each Category with its amount this month and the change since the month before (▲/▼ and the amount, "new" when it had nothing last month, "same" when unchanged). More spending is shown as bad and more income as good. A Category that only had activity last month stays listed with zero.
Retired labels are included everywhere a Category is.

**Receipt photos.** A Transaction can carry up to 5 photos, added in the Transaction form ("Add photo" opens the camera or photo library on a phone). Photos are shrunk when added (longest side 1280 px, JPEG quality 0.8, about 150 KB each) and stored in IndexedDB in their own store, linked to the Transaction by id. Adding or removing a photo waits for Save; cancelling the form discards the changes. A paperclip in the Transactions list marks Transactions that have photos, and tapping a thumbnail shows the photo full size. Adding or removing a photo counts as a change for the backup reminder. Photos are not OCR-read. Deleting a Transaction keeps its photos for the Undo window; photos with no Transaction are removed the next time the app opens. CSV files cannot carry photos, so only the ZIP backup does.

**Full backup (ZIP).** Settings has a second backup row, "Full backup (ZIP)", next to the CSV export. One file `money-backup-YYYY-MM-DD.zip` holds `transactions.csv`, `categories.csv`, `recurring.csv` (when there are rules), `settings.json` (language, Opening balance, sort order) and `attachments/<row>-<n>.<jpg|png|webp>`, where `<row>` is the photo's Transaction row in `transactions.csv`. It is shared through the share sheet when supported, otherwise downloaded, and counts as a backup for the reminder. Import accepts a `.zip` or the CSV files in the same dialog. Importing a ZIP is still replace-everything with the same preview, and it also restores the settings it carries and the photos; because the Opening balance came with it, the "Check your opening balance" step is skipped. Settings with an invalid value are ignored. A ZIP without a Transactions and a Categories file, or a file that is not a ZIP, is refused with a message. The CSV export and the backup banner stay as they were and do not include photos.

**Monthly report.** On the Summary tab, "Monthly report" opens a report for the month being viewed: the Balance at the start of the month, Income, Expenses, Net, the Balance at the end, the per-Category lines, and every Transaction day by day (oldest first) with its Categories. "Print / Save as PDF" opens the browser's print dialog, where the user can save a PDF; the print layout hides the app and shows only the report. There is no PDF library, so this works offline and adds nothing to the app size.

**Technology.** One new dependency, `fflate`, for the ZIP. The database is now at version 3 (adds the photos store; existing data is untouched).
