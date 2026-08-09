# Ledger + Strategist — Build Plan

## What we're building

One web app, two tightly integrated modules, for a group of eight entities:

- **Module A — Bookkeeping + Reporting Engine.** Connects to QuickBooks Online,
  keeps a fast local copy of the books, suggests categories for messy
  transactions (you approve everything), flags anomalies, and produces P&L,
  Balance Sheet, and Cash Flow reports per entity and combined.
- **Module B — Tax Strategy Engine.** A guided intake captures what the numbers
  can't (family, home, vehicles, retirement, how the entities relate). A
  structured strategy library is run against your real numbers to produce a
  ranked, dollar-estimated action plan you take to your CPA — with every
  number's math shown.

## Stack (chosen for a non-technical owner)

- **Next.js (TypeScript)** — one app, one command to run, UI + backend together.
- **SQLite via Prisma** — the database is a single file on your computer; no
  database server to install or manage.
- **QuickBooks Online API (OAuth 2.0)** — official connection, read-only in
  practice: this app never writes back to QuickBooks.
- **Anthropic Claude API** — AI categorization suggestions and plain-language
  explanations. Deterministic fallbacks exist so the app works without a key.

## Guardrails baked in

1. Never files taxes, never final advice — every strategy output ends with the
   CPA disclaimer.
2. Human in the loop — the app suggests; nothing changes without your approval,
   and it never posts back to QuickBooks at all.
3. Secrets in `.env` (git-ignored); QuickBooks tokens encrypted at rest
   (AES-256-GCM); no full account numbers logged.
4. Show the math — every dollar estimate has an expandable trace: which
   transactions, which rule, which assumption.
5. Cite the rule, flag the uncertainty — strategies name their tax provision and
   mark year-sensitive parameters as "verify for current year with CPA."

## The eight entities

Whiplash Center of Utah, Family Health and Rehab, Running Wild Utah,
PI Warriors, SandCastle 1/2/4/5 LLC. The SandCastle LLCs are treated as
likely holding/real-estate entities — the intake asks you to confirm each
one's actual role rather than assuming.

## Folder structure

```
ledger-strategist/
  app/            pages (dashboard, reports, review, intake, plan, ...)
    api/          backend routes (QuickBooks OAuth, sync, categorize, ...)
  lib/            the engines: reports math, anomaly rules, strategy
                  library + analyzer, QuickBooks + Claude clients
  prisma/         database schema + seed (demo books for all 8 entities)
  tests/          tests for the money-critical math
  data/           your local database file (git-ignored)
```

## Build order (each phase committed separately)

1. Scaffold + hello world + run instructions ✅
2. Database schema, the 8 entities, realistic demo books, QuickBooks OAuth +
   sync engine (sandbox mode supported)
3. Dashboard + P&L / Balance Sheet / Cash Flow + CSV export + print-to-PDF
4. Categorization assistant (Claude + learned rules) + anomaly flags
5. Strategy engine: intake, 15-strategy library, analyzer with math traces,
   ranked action plan, scenario mode, CPA briefing
6. Month-end close checklist, tax-ready CPA package, tests + verification
