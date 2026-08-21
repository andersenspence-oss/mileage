# PI Warriors Copy Studio

A web app that writes a week of PI Warriors social copy in one run, sized to each
platform, with the hashtags and the image or video suggestion attached to every
post. It lives on the same free GitHub Pages site as the mileage tracker and the
E6B, and it goes on your phone's home screen the same way.

`https://YOURUSERNAME.github.io/mileage/piwarriors/`

---

## What one run produces

Pick the platforms, pick how many days, tap **Write this week's copy**. The
default week is:

| Platform | Per day | Over seven days |
|---|---|---|
| LinkedIn | 1 | 7 |
| Instagram | 3 | 21 |
| Facebook | 3 | 21 |
| X | 6 (adjustable 5 to 7) | 42 |

These posts are conversation starters, not advertising. Almost none of them
sell anything: they teach, reframe, admit something, or ask a question a
provider can actually answer. Selling is rationed on purpose, and the app
enforces the ration rather than trusting the model to remember it.

Every post arrives with three things you can copy on their own with one tap:

1. **The post**, ready to paste, already inside the platform's character limit.
2. **The hashtags and tags**, on one line, comma separated.
3. **The media brief** — what to shoot or build, the on-screen text, and alt
   text. Carousels and Reels come with the slide-by-slide breakdown.

There are also copy buttons for a whole day, a whole platform's week, and the
entire run, plus a download button for the run as a text file.

---

## Setup, once

### 1. Get an Anthropic API key

The app writes the copy by calling Claude directly from your phone. Create a key
at <https://console.anthropic.com> → API Keys.

### 2. Put the key in the app

Open the app → **Settings** → paste the key → **Test the connection**. You want
the green line saying the model replied.

The key is stored in this phone's browser storage and is sent only to Anthropic.
It never goes into this repository and never passes through any other server.
Anyone who can unlock the phone can read it, so use a key you are willing to
rotate, and rotate it if the phone is lost.

### 3. Add it to the home screen

In Safari, open the address above, tap **Share** → **Add to Home Screen**. It
then opens full screen like an app.

---

## Where the material comes from

Good copy needs something real to react to. The app pulls from two places.

**The web, searched live.** Each run starts by searching for what is actually
being argued about in the PI provider world that week: insurance industry
changes, automated and algorithmic claim review, state law changes, what
providers are publicly complaining about, what plaintiff attorneys are saying
about provider documentation. That briefing is shown in the results under
*This week's research briefing*, with its sources, so you can see what the week
was built on.

**What you have seen.** The **What have you seen?** box on the Write tab is
weighted more heavily than anything the search finds. Paste in threads,
comments, DMs, group posts, or attorney conversations. Two or three real lines
from a Facebook group will shape a week more than any amount of searching.

A note on what this cannot do: it does not log into your X, Facebook, LinkedIn
or Instagram accounts and read your own comment threads. Those platforms do not
allow that from a static web page without an approved app and a server, and this
app deliberately has neither. The paste box is the bridge. If you later publish
through Blotato, its API can expose your own comments and top posts, and that
would slot in as a third source.

---

## What the app guarantees

**Nothing comes back over the limit.** Every post is counted the way the
platform counts it. X uses the real weighting: a link costs 23 characters
whatever its length, and emoji and CJK characters cost two. The body and the
hashtags are counted together, because that is how it lands when you paste it.

If a post comes back too long, too heavily hashtagged, or reading like it was
machine-written, the app sends it back to be rewritten with the exact problem
stated, up to three times. If it is still wrong after that, the app trims it
itself at a sentence boundary and tells you on the card that it did. You should
never have to edit for length.

| Platform | Ceiling used | Hashtags | Fold |
|---|---|---|---|
| LinkedIn | 3,000 | 3 to 5 | 210 |
| Instagram | 2,200 | 12 to 30 | 125 |
| Facebook | 1,500 by default, 63,206 available | 2 to 5 | 477 |
| X | 280, or 25,000 with Premium | 0 to 2 | 280 |

"Fold" is where the composer hides the rest behind *see more*. The app warns you
on the card when an opening line runs past it.

**The voice is checked, not assumed.** Every post is scanned for the phrasing
that gives machine writing away, including the phrases the brand rules ban
outright. Anything caught is rewritten. Anything still slightly off is flagged
on the card rather than hidden. The scanner was calibrated against the brand's
own vocabulary and book quotes, so real PI Warriors language passes untouched.

**By default, the app states no outside facts at all.** This is the guardrail
that matters most. A wrong statute number published under a real name, to
providers and plaintiff attorneys who look things up, does more damage than any
other mistake this app can make.

Out of the box the run writes only from Dr. Spence's own practice. No statute, no
regulation, no court case, no company or agency by name, no statistic, no
effective date. That is not a limitation on the argument: the posts that made
this brand work are the ones about cases he handled, and a post that leans on a
citation is both weaker and riskier than one that does not. A post that reaches
for an outside fact is rewritten, and if it keeps reaching, it is held back.

**Held back means held back.** A post that does not pass is not shown with a
warning label on it. It does not appear among the copy, it is not in any copy
button, it is not in the download, and it is not counted as delivered. It is
listed separately with the reason, so the decision is visible rather than
silent. Every export path runs through one function to make that true, and a
test asserts it for the whole run, one platform and one day.

**If you do want to use current events**, Settings has a second mode where
outside facts are allowed and every one of them is looked up again on its own
before the post is finalised. That check is adversarial: it searches for the
primary source and compares it against the claim word by word, and only a
verdict of "supported" passes. A claim that is real but described more broadly
than the source supports comes back "overstated" and fails, because that is the
dangerous shape. It reads authoritative and it is wrong. Verified claims carry
their source URL and the line of insurance they actually govern. This costs a
search per claim, so runs are slower and dearer.

**Sourcing is still checked underneath both modes.** This is the guardrail that matters most,
because a wrong bill number in front of providers and attorneys costs more than
any clumsy sentence.

Two sources are allowed: the week's research briefing, and Dr. Spence's own
practice. Nothing else. The generator is told not to reach into memory for a
statute, a court case, a percentage or an effective date, and every outside fact
a post uses must be declared with the briefing line behind it.

That declaration is then checked rather than trusted. The app scans each post
for the things that are checkable about the outside world: bill numbers,
regulation codes, court cases, named companies and agencies, large figures,
percentages, effective dates, attributions to a study or report. Anything found
that is not declared, or declared as coming from the briefing but absent from
it, sends the post back to be rewritten with the fact removed rather than
softened. Clinical numbers are left alone, so "45 degrees of cervical rotation"
and "six of eighteen visits" never trip it, and so are the brand's own figures.

If a claim survives the rewrites, the post is badged **Unsourced**, the run
warns about it at the top, and the specific problem is named on the card.
Publishing it then takes a decision rather than an accident.

Every post that states an outside fact carries a **Check before posting**
section listing each claim and the briefing line behind it, so verifying a week
takes a minute rather than a fact check afterwards.

**One trap worth knowing about.** Most insurance regulation in the news governs
health insurance. PI providers are paid by auto carriers through PIP and bodily
injury, by workers compensation, and through liens, and health insurance rules
generally do not bind an auto adjuster. The briefing now labels every fact with
the line of insurance it actually governs, and the generator is told never to
imply a health insurance rule reaches auto claims.

**It does not repeat itself.** The last eight runs are kept on the phone, and
every new run is given the previous themes and opening lines with instructions
not to reuse them.

**Selling stays rare.** Before a run starts, the app decides which specific
platform-days are allowed a call to action, spreads them so the ask never lands
twice in a row, and tells every other batch in plain terms that it may not sell
at all. At the default of one per platform per week that is four selling posts
in about ninety.

A post outside that budget is not allowed to slip an ask in at the end. Links,
sign-up lines, "book a call", "link in bio" and crash101.com URLs are all
treated as faults in a post that was not allocated a sell, and it is sent back
to be rewritten with the ask removed rather than softened. Manufactured urgency
is banned everywhere, including in the selling posts: no countdowns, no
scarcity, no discounts. Urgency is earned.

Every card is badged with what the post is for, so a week is readable at a
glance:

| Badge | What it is |
|---|---|
| Conversation | Asks something real and leaves room for the answer |
| Insight | Reframes or teaches something |
| Story | A specific thing that happened |
| Soft CTA | The rationed selling post, one quiet line at the end |

Change the cadence in **Settings → Selling posts per platform, per week**.
Zero produces a week that sells nothing at all.

---

## Settings worth knowing

- **X Premium** raises the X ceiling from 280 to 25,000 characters.
- **Instagram hashtags in the first comment** takes the hashtags out of the
  caption's character budget.
- **Long Facebook posts** lifts the 1,500 character target to Facebook's real
  ceiling. The default target exists because reach falls off well before that.
- **Selling posts per platform, per week** sets how often a call to action is
  allowed. One is the default. Zero sells nothing.
- **Tag separator** controls how the tag line is displayed and copied. The
  *Post + tags* button always uses spaces, because that is what the composers
  parse.
- **Models.** Each platform runs on its own model, set in Settings. Out of the
  box, research, planning, LinkedIn, Instagram and Facebook run on Opus 5, and X
  runs on Sonnet 5. X posts are short and structural, so they lose the least
  from the cheaper model, while a LinkedIn post is where the voice does the most
  work. If X copy ever reads flat, switch it back; that is the one to watch.
  There is an "Everything on Opus" button when you want the run at full quality.

## What a run costs

The Write tab shows an estimate before you start, and the Settings screen shows
what the current model mix costs against running everything on Opus.

A full seven-day run across all four platforms is about 30 API calls and four
minutes. Rough figures for the low end of the estimate:

| Setup | A seven-day run |
|---|---|
| Everything on Opus 5 | about $1.87 |
| Default mix, X on Sonnet 5 | about $1.70 |
| X, Instagram and Facebook on Sonnet 5 | about $1.31 |
| Everything on Sonnet 5 | about $1.12 |

Two things keep that down. The brand prompt and the week's research briefing are
identical on every call, so they are sent once and cached; every later batch
reads them at a tenth of the input price. And each platform pays only for the
model it actually needs.

Because the two setup calls are paid once and caching kicks in after the first
batch, longer runs cost less per day. Fourteen days is not twice the price of
seven.

## Troubleshooting

Settings has a **Run full diagnostics** button. It works through what a run
needs, one capability at a time, and stops at the first thing that is broken:
reaching the API, structured replies, web search, and each platform's model. The
first FAIL line is the one to fix.

- **"The Anthropic account behind this key has no API credit"** — the most common
  first wall. API usage is billed separately from a Claude.ai subscription, and a
  new account starts with nothing on it. Add credit under Billing at
  console.anthropic.com.
- **"The API key was rejected"** — the key is wrong, was truncated when copied,
  or has been revoked. Paste it again in Settings.
- **"Could not reach the API"** — usually the phone's connection. The app retries
  with a growing delay before giving up.
- **A batch failed** — the results page lists which platform and day failed and
  why. Everything else in the run is still there. Run it again for the rest.
- **It looks stuck on "Reading the room"** — the research step runs web searches
  server-side and is the slowest part of a run, often a minute or two. The
  progress card shows a running clock and says what it is doing ("Searching",
  "Still searching", "Writing the briefing"), so a slow step is easy to tell
  apart from a dead one. If nothing at all comes back for two and a half
  minutes, the app gives up on that request and says so rather than sitting
  there.
- **Copy did not work** — the button turns red and says to press and hold. This
  only happens on much older browsers; the text is selectable either way.
- **The phone shows an old version** — close the app fully and reopen it twice.
  The first open downloads the update, the second runs it. The build number at
  the bottom of Settings tells you which version the phone is actually running.

## Development

```
npm test        # 76 tests over the counting, limits, voice, sourcing, verification, selling cadence, cost model and export logic
```

The app is plain ES modules with no build step and no dependencies, matching the
other apps in this repository. `js/limits.js` holds the platform rules and the
character maths, `js/voice.js` the machine-writing and selling scanners, `js/claims.js` the sourcing gate, `js/verify.js` the independent fact check, `js/brand.js` the
brand system prompt, and `js/generate.js` the run pipeline.
