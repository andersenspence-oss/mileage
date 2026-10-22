# Ledger + Strategist

**Bookkeeping for every entity you own, built around QuickBooks 2016 Desktop, plus a tax strategy engine.**

This app does two jobs:

1. **Does the bookkeeping work.** You download each bank and card account as a
   CSV file and drop it in. The app skips anything already imported, matches
   checks and ADP payroll you entered by hand, suggests a category for
   everything else (you approve each one, and it learns), reconciles each
   account to its statement, and then hands QuickBooks 2016 one finished file
   to import. **QuickBooks stays the official books; nothing gets typed twice.**
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
`prisma/data` folder; your numbers never leave your computer), and loads realistic
**demo books** so you can explore every screen
immediately.

### 5. Start the app (this is the everyday command)

```
npm start
```

Then open your web browser and go to: **http://localhost:4545**

To stop the app, go back to the terminal and press `Ctrl` + `C`.

---

## Going live with QuickBooks 2016 (once per entity, about 20 minutes)

1. **Clear the demo data**: Entities page, bottom, *Clear demo data* (all entities).
2. **Load each company's lists**: in QuickBooks 2016, open that entity's company
   file, then **File > Utilities > Export > Lists to IIF Files**. Check *Chart of
   Accounts, Customer List, Vendor List, Employee List, Other Names List*, save
   the file. In the app: **QuickBooks 2016** page, pick the entity, *Load lists*.
   Do this again any time you add accounts in QuickBooks.
3. **Set each bank and card account's starting point**: same page, step 2. Pick
   the last statement date you already reconciled in QuickBooks and enter that
   statement's ending balance (for a card, the amount owed). Anything on or
   before that date is treated as already in QuickBooks: it's used for reports
   and tax analysis but never sent to QuickBooks again. Tip: import a year of
   history right away so the reports and tax strategy have real numbers.
4. The first time you enter an ADP payroll, pick its accounts; the app fills
   them in after that.

## The routine

**Weekly (about 15 minutes)**

1. **Import Bank & Card**: download each account as CSV (overlap is fine) and upload it.
2. **Review Queue**: *Approve all 90%+ sure*, then decide the rest. Picking a bank
   or card account as the "category" records a transfer (like paying the credit
   card); the matching line on the other account is combined automatically.
3. **Payroll (ADP)**: enter each payroll from ADP's payroll summary. It becomes
   one bank entry per ADP debit (net pay, tax deposit, fee), so the bank download
   matches it instead of adding it twice.

**Monthly, when statements arrive**

1. **Reconcile** each account: enter the statement date and ending balance, check
   off what's on the statement, finish at a $0.00 difference. Reconciled items lock.
2. **QuickBooks 2016 > Send to QuickBooks**: create the file and download it. In
   QuickBooks: **back up first** (File > Back Up Company), then **File > Utilities >
   Import > IIF Files**. Reconciled items arrive already marked cleared.
3. **Month-End & CPA Package**, then **Download backup** (Entities page).

## Adding or selling an entity

- **Bought or started one**: Entities page, *Add an entity*, then set it up on the
  QuickBooks 2016 page like the others.
- **Sold one**: Entities page, *Mark as sold* with the sale date. Its history stays
  in reports and tax analysis for the years you owned it; it leaves the daily
  screens. *Make active again* undoes it. Only an entity with no real
  transactions can be deleted permanently.

## What protects the books

- Nothing is sent to QuickBooks twice; each file is recorded, and a file that was
  never imported can be undone.
- Nothing unbalanced is ever written to a QuickBooks file.
- Accounts that aren't in that company's QuickBooks chart are blocked from export,
  instead of quietly creating new accounts in QuickBooks.
- Reconciled transactions can't have their date or amount changed.
- Anything changed after it went to QuickBooks is listed on the QuickBooks 2016
  page so the same fix gets made there.
- `npm run seed` refuses to run once real bookkeeping exists.
- **Backups**: everything lives in one file on this computer
  (`prisma/data/ledger.db`). Use *Download backup* on the Entities page weekly.
  To restore: stop the app, put the backup in `prisma/data/` named `ledger.db`,
  start the app.

## Where to paste keys: quick reference

| Key | Where to get it | Where to paste it |
|---|---|---|
| Anthropic API key (optional; much smarter category suggestions) | console.anthropic.com > API Keys | `.env` > `ANTHROPIC_API_KEY=` |

The QuickBooks Online keys in `.env` belong to an older sync feature and aren't
needed with QuickBooks 2016.

## A tour of the screens

- **Bookkeeping Home**: what needs doing for every active entity, account by account.
- **Import Bank & Card**: upload CSV downloads; preview, fix columns once, import.
- **Registers**: each bank and card account with a running balance; add checks by hand.
- **Payroll (ADP)**: enter a payroll; balanced entries through Payroll Liabilities.
- **Reconcile**: statement-by-statement, with a printable report.
- **QuickBooks 2016**: load lists, set starting points, create and download IIF files.
- **Dashboard** — revenue, expenses, net, and cash for every entity and the
  combined group, with plain-language callouts about what changed.
- **Entities**: add, edit, mark sold, back up.
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
- **Receipts** — every receipt tied to the transaction it proves. Fuel receipts
  flow in from the mileage app automatically; upload a photo of anything else
  and the AI reads the vendor, date, and total. One click matches receipts to
  transactions (you confirm each match), and a coverage score shows which
  receipt-sensitive expenses (meals, travel, fuel, supplies) still lack
  documentation.
- **Travel & Per Diem** — log overnight business trips and the app computes
  the meals-and-incidentals per-diem deduction (75% travel days and the 50%
  meals limit applied honestly). Feeds the strategy engine automatically.
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
- **Start fresh (demo only)**: delete the `prisma/data` folder and run `npm run setup`
  again. Never do this once real bookkeeping is in the app; restore a backup instead.
- **A bank's CSV imports oddly**: on the preview screen, fix the date/amount
  columns or check "Flip + and −", then *Update preview*. The app remembers it.
- **QuickBooks says an account doesn't exist** during IIF import: the account was
  renamed in QuickBooks. Reload the lists on the QuickBooks 2016 page and create
  the file again.

---

*This software provides estimates and organizational tools only. It does not
file taxes or provide tax, legal, or accounting advice. Verify eligibility and
current law with your CPA before acting on anything it suggests.*
