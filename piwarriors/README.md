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

**It does not repeat itself.** The last eight runs are kept on the phone, and
every new run is given the previous themes and opening lines with instructions
not to reuse them.

---

## Settings worth knowing

- **X Premium** raises the X ceiling from 280 to 25,000 characters.
- **Instagram hashtags in the first comment** takes the hashtags out of the
  caption's character budget.
- **Long Facebook posts** lifts the 1,500 character target to Facebook's real
  ceiling. The default target exists because reach falls off well before that.
- **Tag separator** controls how the tag line is displayed and copied. The
  *Post + tags* button always uses spaces, because that is what the composers
  parse.
- **Model.** Opus 5 is the default and writes the best copy. Sonnet 5 is cheaper
  and faster and noticeably blander.

## What a run costs

The Write tab shows an estimate before you start. A full seven-day run across
all four platforms is roughly 30 API calls, about four minutes, and somewhere
around two to five dollars of API usage on Opus 5. A single platform for a week
is well under a dollar.

## Troubleshooting

- **"The API key was rejected"** — the key is wrong or has been revoked. Paste it
  again in Settings and use Test the connection.
- **"Could not reach the API"** — usually the phone's connection. The app retries
  with a growing delay before giving up.
- **A batch failed** — the results page lists which platform and day failed and
  why. Everything else in the run is still there. Run it again for the rest.
- **Copy did not work** — the button turns red and says to press and hold. This
  only happens on much older browsers; the text is selectable either way.
- **The phone shows an old version** — close the app fully and reopen it twice.
  The first open downloads the update, the second runs it.

## Development

```
npm test        # 36 tests over the counting, limits, voice and export logic
```

The app is plain ES modules with no build step and no dependencies, matching the
other apps in this repository. `js/limits.js` holds the platform rules and the
character maths, `js/voice.js` the machine-writing scanner, `js/brand.js` the
brand system prompt, and `js/generate.js` the run pipeline.
