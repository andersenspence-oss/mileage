# Ledger + Strategist

**Your books and your tax strategy, in one place, across all eight entities.**

This app does two jobs:

1. **Keeps your books clean.** It connects to QuickBooks Online, keeps a fast
   local copy of every entity's numbers, suggests categories for messy
   transactions (you approve every one), flags duplicates and odd charges, and
   produces Profit & Loss, Balance Sheet, and Cash Flow reports — per entity
   and for the whole group.
2. **Finds tax-saving moves.** You fill out a one-time questionnaire about your
   situation. The app runs a library of well-known, legally sound tax
   strategies against your real numbers and gives you a ranked list: estimated
   dollar savings, the math behind each number, and exactly what to ask your
   CPA.

> **Important:** This app never files taxes and never gives final tax advice.
> Every estimate ends with: *"Estimate only. Verify eligibility and current law
> with your CPA before acting."* Your CPA signs the return; this app prepares
> and recommends.

---

## How to install and run it (no experience needed)

You only do steps 1–4 once. After that, starting the app is one command.

### 1. Install Node.js

Node.js is the free engine that runs the app.

- Go to <https://nodejs.org> and download the **LTS** version.
- Run the installer and click through with the default options.

### 2. Open a terminal in this folder

- **Mac:** open the **Terminal** app. Type `cd ` (with a space), drag this
  `ledger-strategist` folder from Finder into the Terminal window, press Enter.
- **Windows:** open the `ledger-strategist` folder in File Explorer, click the
  address bar, type `cmd`, press Enter.

### 3. Create your settings file

- In this folder, find the file named `.env.example`.
- Make a copy of it and rename the copy to exactly `.env`
- Open `.env` in any text editor (Notepad / TextEdit is fine) and:
  - Replace the `APP_SECRET` line's value with any long random sentence.
  - Paste your **Anthropic API key** after `ANTHROPIC_API_KEY=` (get one at
    <https://console.anthropic.com>). Optional — the app works without it, but
    the AI categorization assistant is much better with it.
  - QuickBooks keys can wait until you're ready to connect (see below).

### 4. One-time setup command

In the terminal, type this and press Enter:

```
npm run setup
```

This installs everything, creates your local database (a single file in the
`data` folder — your numbers never leave your computer), and loads realistic
**demo books for all eight entities** so you can explore every screen
immediately.

### 5. Start the app (this is the everyday command)

```
npm start
```

Then open your web browser and go to: **http://localhost:4545**

To stop the app, go back to the terminal and press `Ctrl` + `C`.

---

## Connecting QuickBooks Online (when you're ready)

1. Go to <https://developer.intuit.com>, sign in with your QuickBooks account,
   and create a free app (choose the **QuickBooks Online Accounting** scope).
2. In your Intuit app's settings, add this exact Redirect URI:
   `http://localhost:4545/api/qbo/callback`
3. Copy the **Client ID** and **Client Secret** into your `.env` file.
4. Keep `QBO_ENVIRONMENT="sandbox"` at first — sandbox is Intuit's safe test
   mode with fake data. Switch it to `"production"` only when you're ready to
   pull your real books.
5. Restart the app, go to **Entities & QuickBooks**, and click
   **Connect QuickBooks** next to an entity. Approve the connection in the
   window that opens, then click **Sync now**.

The app only *reads* from QuickBooks. It never writes anything back, so it can
never mess up your books.

## Where to paste keys — quick reference

| Key | Where to get it | Where to paste it |
|---|---|---|
| Anthropic API key | console.anthropic.com → API Keys | `.env` → `ANTHROPIC_API_KEY=` |
| QuickBooks Client ID | developer.intuit.com → your app | `.env` → `QBO_CLIENT_ID=` |
| QuickBooks Client Secret | developer.intuit.com → your app | `.env` → `QBO_CLIENT_SECRET=` |

## A tour of the screens

- **Dashboard** — revenue, expenses, net, and cash for every entity and the
  combined group, with plain-language callouts about what changed.
- **Entities & QuickBooks** — the eight entities, connection status, sync.
- **Review Queue** — transactions the AI wasn't sure about, with its suggested
  category and confidence. You approve, change, or reject. It learns from you.
- **Anomaly Flags** — likely duplicates, unusual charges, possible
  personal-vs-business mix-ups.
- **Reports** — P&L, Balance Sheet, Cash Flow for any date range, per entity or
  combined. Print to PDF or download CSV.
- **Mileage & Vehicles** — a live feed from the Mileage Log phone app you and
  Carey use. Connect it once (instructions on the page: publish your mileage
  Google Sheet as a CSV link, or just upload the app's CSV export) and the tax
  strategy engine uses your real logged miles and per-trip IRS rates instead
  of estimates. Trip categories map straight onto your entities, and receipt
  photo links come along for the ride.
- **Situation Intake** — the one-time questionnaire that powers the strategy
  engine. Update it whenever life changes.
- **Strategy Library** — the playbook of tax strategies. You can add your own.
- **Action Plan** — your ranked opportunities with estimated savings, the math,
  a CPA verification checklist, what-if toggles, and a printable CPA briefing.
- **Month-End & CPA Package** — a close checklist and a one-stop export bundle
  to hand your accountant.

## If something goes wrong

- **"npm is not recognized"** — Node.js isn't installed yet (step 1), or close
  and reopen the terminal after installing.
- **The page won't load** — make sure the terminal window running `npm start`
  is still open; the app stops when you close it.
- **Start fresh** — delete the `data` folder and run `npm run setup` again.
  (This resets to demo data; QuickBooks connections must be redone.)

---

*This software provides estimates and organizational tools only. It does not
file taxes or provide tax, legal, or accounting advice. Verify eligibility and
current law with your CPA before acting on anything it suggests.*
