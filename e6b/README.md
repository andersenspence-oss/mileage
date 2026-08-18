# E6B Flight Computer

An offline electronic flight computer — the same job Sporty's E6B app does, built as a web app that installs to the home screen, costs nothing, and works with the phone in airplane mode.

**Live at:** `https://YOURUSERNAME.github.io/mileage/e6b/`
(this app lives in the `e6b/` folder of the mileage repo; the mileage tracker is still at the repo root and is untouched)

---

## What it does

**41 calculators**, plus five full tool pages.

### Flight
| | |
|---|---|
| True airspeed & density altitude | CAS → TAS with compressibility, DA, PA, Mach, σ, EAS |
| Mach ↔ TAS | speed of sound, ram rise, total air temperature |
| Heading & groundspeed | the wind triangle, solved with trigonometry |
| Determine the wind aloft | heading + TAS + track + GS → the actual wind |
| Wind components | headwind, crosswind, gust case, demonstrated-limit check |
| Runway analysis | every runway ranked, with true→magnetic wind conversion |
| Winds aloft interpolation | vector interpolation between two FD levels |
| Track from an uncorrected heading | drift and how far off course it puts you |
| Off-course correction | the 1-in-60 rule, track error + closing angle |
| True / magnetic / compass | the whole chain with variation and deviation |
| Distance & course between points | great circle and rhumb line from lat/long |
| Radio range & horizon | VHF line of sight, visual horizon, DME slant range |

### Planning
Time·speed·distance · fuel burn/time/quantity · trip fuel with legal reserves · climb & descent · top of descent · required rate of descent · glide · turn performance · load factor & maneuvering speed · point of no return · equal time point · holding entry · holding wind correction and leg timing · visual descent point · specific range.

### Atmosphere
Pressure & density altitude · standard atmosphere and ISA deviation · true altitude and cold-weather correction · altimeter setting ↔ station pressure · cloud base, dewpoint, humidity and freezing level.

### Conversions
Distance · speed · weight · volume · pressure · time · temperature · fuel weight by grade · rate and gradient.

### Tool pages
- **Nav log** — multi-leg flight plan: per-leg wind triangle, magnetic headings, ETE, ETA, fuel burned and fuel remaining, with a warning when the reserve drops below 45 minutes.
- **Weight & balance** — editable stations, gallons-to-pounds by fuel grade, CG, %MAC-ready moments, a live CG envelope drawn from your POH vertices, and the landing CG after fuel burn.
- **METAR & TAF decoder** — decodes offline (nothing is uploaded), computes the flight category, and turns the report into density altitude and runway wind components.
- **Sunrise, sunset & night** — NOAA solar algorithm, all three twilights, and the three different regulatory definitions of night side by side.
- **Timer** — elapsed timer with leg splits, plus a countdown with holding-leg presets.
- **Reference** — VFR minimums, fuel/oxygen/lights, airspace, speed limits, transponder rules, cruising altitudes, currency, inspections, light gun signals, compass errors, V-speeds, rules of thumb, and generated standard-atmosphere / crosswind / standard-rate-turn tables.

---

## Accuracy

This is the part that matters for a knowledge test, so it is worth being explicit about what is computed and how.

- **Pressure altitude** uses the FAA rule — `field elevation + (29.92 − altimeter setting) × 1000` — because that is the method the FAA teaches and the answer keys are built on. The exact barometric value (about 925 ft per inch of mercury) is shown alongside it wherever it differs.
- **Density altitude** is solved from the ICAO standard atmosphere rather than the 118.8 ft/°C classroom shortcut, so it matches the FAA density-altitude chart. The shortcut is displayed next to it for comparison.
- **True airspeed** uses the full compressible relation (`qc → Mach → TAS`), the same one an air-data computer uses. Below about 200 kt it agrees with the slide-rule answer to a fraction of a knot; at jet speeds the slide rule over-reads by 15+ kt, so both figures are shown.
- **The wind triangle** is exact trigonometry, not a graphical approximation, and its inverse round-trips to within 0.001°.
- **Holding entries** follow the AIM 5-3-8 sectors (70° teardrop, 110° parallel, 180° direct) and flag headings within 5° of a sector boundary, where either entry is legal.
- **Unit conversions** use the internationally defined exact factors (1 NM = 1852 m, 1 lb = 0.45359237 kg, 1 US gal = 3.785411784 L).

Everything above is covered by a test suite. Run it with:

```sh
cd e6b
npm test          # or: node --test "test/*.test.js"
```

87 tests check the maths against published ICAO table values, worked textbook problems, and round-trip identities (CAS↔TAS, wind triangle↔wind determination, ballast↔resulting CG). Any change that moves an answer breaks a test.

---

## Installing it on a phone

1. Open `https://YOURUSERNAME.github.io/mileage/e6b/` in Safari (iPhone) or Chrome (Android).
2. Share → **Add to Home Screen**.
3. Open it once while online. From then on it runs with no signal — the service worker caches the whole app.

There is no account, no network call, and no analytics. Everything you type is saved in the browser's local storage on that device only.

---

## Using it

- **Grey numbers are defaults.** Type over them; what you type is saved and comes back next time.
- **Tap a unit button** (kt, ft, °C…) to cycle units. The value converts as you switch.
- **Leave a box empty** in Time·Speed·Distance or Fuel and that box becomes the answer.
- **"Show the work"** under most results expands the formula with your numbers substituted in — useful when studying, and useful when an answer looks wrong.
- **Star** a calculator to pin it to the top of the list. Recent ones appear there too.
- Time boxes accept `1:30` as well as `90`. Coordinates accept `4030N`, `40 30.5 N` or `-111.891`.

---

## Structure

```
e6b/
  index.html            shell
  css/e6b.css           styling (dark first, light supported)
  js/core/              pure computation, no DOM — the part under test
    units.js            exact conversion factors, angle and time formatting
    atmosphere.js       ICAO standard atmosphere, altimetry, moisture
    airspeed.js         CAS/EAS/TAS/Mach, load factor, Va
    wind.js             wind triangle and its inverse, runway components
    nav.js              time-speed-distance, magnetic chain, great circle, PNR/ETP
    maneuver.js         turns, climbs, descents, glides
    fuel.js             burn, endurance, trip fuel, reserves
    wb.js               weight and balance, envelope geometry
    holding.js          entry sectors, wind-corrected legs
    metar.js            METAR/TAF parser and decoder
    sun.js              NOAA solar position
    flightplan.js       multi-leg nav log
  js/calcs/             calculator definitions (declarative: fields + compute)
  js/pages/             the tool pages
  js/ui.js              DOM helpers, unit-aware fields, result rendering
  js/app.js             router and catalogue
  test/                 node --test suites
  sw.js                 offline cache
```

Adding a calculator means appending one object to a file in `js/calcs/` — fields and a `compute()` that returns primary/secondary/work/notes. The UI is generated from that.

---

## Limits, stated plainly

- It is a **calculator, not a certified navigation source.** Cross-check anything that matters against the POH, the chart and the current regulations.
- The reference tables summarise 14 CFR and the AIM for study. The controlling text is the current edition of each.
- There is no airport database — coordinates, elevations and runway numbers are entered by hand, which keeps the app honest about where its data comes from.
- No weather download. The decoder works on a report you paste in, which is what makes it work offline.
- The weight-and-balance page starts with example numbers for a generic four-seat single. Replace them with your aircraft's actual figures before using it for a real flight.
