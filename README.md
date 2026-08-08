# Mileage Log — Web App (the free version)

This is the **no-Apple-fee** version of the mileage tracker: a web app you and Carey add to your iPhone home screens. No Mac, no $99/year Apple Developer account, no TestFlight, no app expirations. Updates are instant for both phones.

Everything from the native app is here: Spence/Carey profiles, the six categories, beginning/ending odometer + tripometer + receipt photos, tap-to-confirm OCR, in-progress trips, offline logging with automatic sync, date-based IRS rates, discrepancy flags and sanity checks, void-instead-of-delete with audit notes, the dashboard, CSV + printable-PDF export, annual odometer capture, and photos embedded in the Google Sheet cells with full-resolution backups in Drive.

**Total cost: $0.** (GitHub hosting is free, Google's APIs are free at this volume, OCR runs in the browser for free.)

**Known tradeoff:** browser OCR (Tesseract) is weaker than the native iPhone version, especially on glowing dashboard digits. Photos are always captured either way — worst case you type the number yourself, and the log is just as IRS-defensible.

---

## Setup — three steps, ~30 minutes total, once

### Step 1 — Put the app online (free, GitHub Pages)

1. Create a free account at https://github.com (either of you; remember which).
2. Top-right **+** → **New repository**. Name: `mileage`. Leave it **Public** (required for free Pages; the app contains no secrets — your data lives in Google, not in these files). Click **Create repository**.
3. On the new repo page click **uploading an existing file**, then drag in **everything inside this `web` folder** (index.html, sw.js, manifest.webmanifest, the css/, js/ and icons/ folders — not the `web` folder itself). Click **Commit changes**.
4. Repo **Settings** tab → **Pages** (left sidebar) → under "Branch" choose **main** and **/ (root)** → Save.
5. After a minute or two your app is live at:  `https://YOURUSERNAME.github.io/mileage/`  ← this is the address you'll need in Step 2 and open on the phones.

### Step 2 — Let the app talk to your Google Sheet (free)

1. Go to https://console.cloud.google.com and sign in with the Google account that owns the Sheet.
2. Project dropdown (top bar) → **New Project** → name `Mileage Tracker` → Create (then make sure it's selected).
3. **APIs & Services → Library**: enable **Google Sheets API**, then **Google Drive API**.
4. **APIs & Services → OAuth consent screen**: User type **External** → app name `Mileage Log`, your email in both contact fields → save through the rest. Then under **Audience → Test users**, **add both Google accounts** (yours and Carey's). While the app is in "Testing" mode only those accounts can sign in — that's what you want. (Google may show an "unverified app" warning at sign-in; tap Advanced → Continue. It's your own app.)
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `Mileage Log Web`
   - Under **Authorized JavaScript origins** click Add URI and enter exactly:  `https://YOURUSERNAME.github.io`  (no path, no trailing slash)
   - Create, and **copy the Client ID** (ends in `.apps.googleusercontent.com`).
6. Back in your GitHub repo: open `js/config.js` → pencil icon (Edit) → paste the Client ID into `googleClientId` → **Commit changes**. Done.
7. In Google Sheets, open the mileage sheet → **Share** → make sure both Google accounts have **Editor** access.

### Step 3 — Put it on the phones

On each iPhone, in **Safari**:
1. Go to `https://YOURUSERNAME.github.io/mileage/`
2. Tap the **Share** button → **Add to Home Screen** → Add. It now has an icon and opens full-screen like a real app.
3. Open it, pick the profile (Spence / Carey), then **Settings → Connect Google Account** and sign in. Tap **Test Sheet Connection** — you want the green ✓.
4. Log a test trip and watch it appear in the sheet (photos included).

---

## Everyday things

- **Change the IRS rate / categories / profiles / vehicles-on-first-install:** edit `js/config.js` in the GitHub repo (pencil icon → commit). Both phones pick it up on the next open or two. Rates are looked up by trip date, so past entries keep their old rates.
- **Offline?** Log normally. Entries queue on the phone and sync when you're back online (or tap **Sync Now** on the Trips tab).
- **Editing a synced entry** updates the same sheet row and asks for a one-line audit note (stored in the Flags column). **Voiding** keeps the row, marks it VOID, and drops it from totals — deliberately, because silently deleted rows are what auditors distrust.
- **Sheet tips:** don't delete the **Entry ID** column (it's how the app finds rows to update). Select the photo columns and set row height to ~80 to see the embedded images. Columns are matched by header name, so you can reorder or add your own.
- **Photo privacy tradeoff:** for images to render inside sheet cells, each uploaded photo is set to "anyone with the link can view." Links are unguessable and only photos are shared this way — never the sheet. Originals also stay in your Drive folder "Mileage Tracker Photos".

## Troubleshooting

- **"No Google client ID configured"** — Step 2.6 not done yet.
- **Sign-in popup closes with an error** — the JavaScript origin in Step 2.5 doesn't exactly match your site address, or the account isn't in Test users (2.4).
- **"Test Sheet Connection" fails** — that account doesn't have Editor access to the sheet, or the `spreadsheetId` in `js/config.js` is wrong (it's the long string in the sheet URL between `/d/` and `/edit`).
- **Images don't show in cells** — give Drive a minute to generate thumbnails, then refresh the sheet.
- **Phone shows an old version** — close the app fully and reopen twice (the first open downloads the update, the second runs it).
- **iPhone storage warning:** Safari can clear website data if the phone runs critically low on space. Synced entries are safe in the Sheet; keep an eye on the Trips tab so nothing sits unsynced for weeks.
