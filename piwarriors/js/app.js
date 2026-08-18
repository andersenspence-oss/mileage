// View layer and wiring. Four tabs: Write, Results, History, Settings.

import { PLATFORMS, PLATFORM_ORDER, postsPerDay } from "./limits.js";
import { PILLARS } from "./brand.js";
import { MODELS, testConnection, estimateRun } from "./api.js";
import { runWeek, buildDays } from "./generate.js";
import { loadSettings, saveSettings, loadRuns, saveRun, deleteRun, getRun, historyFor, storageUsage } from "./store.js";
import { el, clear, copyButton, toast, download, formatDate } from "./ui.js";
import {
  bodyText, tagText, fullText, mediaText,
  dayText, runText, platformText,
  postsForDay, groupByPlatform, countPosts, runErrors,
} from "./format.js";

const view = document.getElementById("view");
const tabbar = document.getElementById("tabbar");

const state = {
  settings: loadSettings(),
  runs: loadRuns(),
  currentRunId: null,
  running: false,
  controller: null,
  progress: { stage: "", detail: "", pct: 0, log: [] },
};

state.currentRunId = state.runs.length ? state.runs[0].id : null;

// Steppers stay inside what each platform can actually carry.
const PER_DAY_RANGE = {
  linkedin: [1, 3],
  instagram: [1, 6],
  facebook: [1, 6],
  x: [5, 7],
};

function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function persist() {
  if (!saveSettings(state.settings)) toast("Could not save settings", "err");
}

// ------------------------------------------------------------------ router

const TABS = ["write", "results", "history", "settings"];

function currentTab() {
  const hash = location.hash.replace(/^#\/?/, "").split("/")[0];
  return TABS.includes(hash) ? hash : "write";
}

function render() {
  const tab = currentTab();
  clear(view);
  if (tab === "write") renderWrite();
  else if (tab === "results") renderResults();
  else if (tab === "history") renderHistory();
  else renderSettings();

  for (const link of tabbar.querySelectorAll("a")) {
    link.classList.toggle("active", link.dataset.tab === tab);
  }
  view.scrollTop = 0;
}

window.addEventListener("hashchange", render);

// ------------------------------------------------------------- write tab

function renderWrite() {
  const s = state.settings;

  if (!s.apiKey) {
    view.appendChild(
      el("div", { class: "card" }, [
        el("h2", { text: "Set the API key first" }),
        el("p", { class: "small muted", text: "This app writes the copy by calling Claude directly from your phone. It needs an Anthropic API key before it can do anything." }),
        el("div", { style: "margin-top:12px" }, [
          el("button", { class: "wide", text: "Open Settings", onclick: () => (location.hash = "#settings") }),
        ]),
      ])
    );
  }

  // Platforms
  const platformCard = el("div", { class: "card" }, [el("h2", { text: "Platforms" })]);
  const grid = el("div", { class: "platforms" });
  for (const id of PLATFORM_ORDER) {
    const p = PLATFORMS[id];
    const on = s.platforms.includes(id);
    const perDay = postsPerDay(id, s);
    const button = el(
      "button",
      {
        class: "platform-toggle",
        type: "button",
        "aria-pressed": String(on),
        onclick: () => {
          const next = new Set(state.settings.platforms);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          // At least one platform has to stay on or a run has nothing to write.
          if (next.size === 0) {
            toast("Keep at least one platform", "err");
            return;
          }
          state.settings.platforms = PLATFORM_ORDER.filter((x) => next.has(x));
          persist();
          render();
        },
      },
      [
        el("span", { class: "pmark", text: p.mark }),
        el("span", {}, [
          el("span", { class: "pname", text: p.name }),
          el("span", { class: "pcount", text: `${perDay} per day · ${p.blurb}` }),
        ]),
      ]
    );
    grid.appendChild(button);
  }
  platformCard.appendChild(grid);
  view.appendChild(platformCard);

  // Volume
  const volume = el("div", { class: "card" }, [el("h2", { text: "How much" })]);
  const dayField = el("div", { class: "field" }, [el("span", { text: "Days in this run" })]);
  dayField.appendChild(stepper(s.dayCount, 1, 14, (n) => {
    state.settings.dayCount = n;
    persist();
    render();
  }));
  volume.appendChild(dayField);

  const startField = el("div", { class: "field" }, [el("span", { text: "Starting" })]);
  startField.appendChild(
    el("input", {
      type: "date",
      value: s.startDate || todayISO(),
      onchange: (e) => {
        state.settings.startDate = e.target.value || todayISO();
        persist();
        renderTotal();
      },
    })
  );
  volume.appendChild(startField);

  for (const id of s.platforms) {
    const [min, max] = PER_DAY_RANGE[id];
    const field = el("div", { class: "field" }, [el("span", { text: `${PLATFORMS[id].name} per day` })]);
    field.appendChild(stepper(postsPerDay(id, s), min, max, (n) => {
      state.settings.perDay = { ...state.settings.perDay, [id]: n };
      persist();
      render();
    }));
    volume.appendChild(field);
  }

  const totalLine = el("p", { class: "small muted", style: "margin-top:10px" });
  volume.appendChild(totalLine);
  view.appendChild(volume);

  function renderTotal() {
    const perDayTotal = state.settings.platforms.reduce((n, id) => n + postsPerDay(id, state.settings), 0);
    const total = perDayTotal * state.settings.dayCount;
    const days = buildDays(state.settings.startDate || todayISO(), state.settings.dayCount);
    const last = days[days.length - 1];
    const est = estimateRun({
      model: state.settings.model,
      batches: state.settings.platforms.length * state.settings.dayCount,
    });
    totalLine.textContent =
      `${total} posts — ${perDayTotal} a day across ${state.settings.dayCount} day${state.settings.dayCount === 1 ? "" : "s"}, ` +
      `${formatDate(days[0].date)} through ${formatDate(last.date)}. ` +
      `Roughly ${est.minutes} minute${est.minutes === 1 ? "" : "s"} and $${est.low.toFixed(2)} to $${est.high.toFixed(2)} of API usage.`;
  }
  renderTotal();

  // Signals
  const notesCard = el("div", { class: "card" }, [
    el("h2", { text: "What have you seen?" }),
    el("p", { class: "small muted", style: "margin-bottom:10px", text: "The run searches the web for what the PI world is arguing about this week. Anything you have seen yourself carries more weight than anything it finds: paste threads, comments, DMs, or attorney conversations here." }),
    el("textarea", {
      placeholder: "A provider in the Facebook group posted a reduction letter that cited 'excessive frequency' on 18 visits...",
      value: state.settings.notes || "",
      oninput: (e) => {
        state.settings.notes = e.target.value;
      },
      onchange: persist,
    }),
  ]);
  view.appendChild(notesCard);

  // Run
  const runCard = el("div", { class: "card" });
  if (state.running) {
    runCard.appendChild(el("h2", { text: state.progress.stage || "Working" }));
    runCard.appendChild(el("p", { class: "small muted", text: state.progress.detail || "" }));
    const bar = el("div", { class: "progress" }, [el("i", { style: `width:${Math.round(state.progress.pct * 100)}%` })]);
    runCard.appendChild(bar);
    const log = el("div", { class: "log" });
    for (const line of state.progress.log.slice(-24)) log.appendChild(el("div", { text: line }));
    runCard.appendChild(log);
    runCard.appendChild(
      el("button", {
        class: "wide quiet",
        style: "margin-top:10px",
        text: "Stop",
        onclick: () => {
          if (state.controller) state.controller.abort();
        },
      })
    );
  } else {
    runCard.appendChild(
      el("button", {
        class: "wide",
        text: "Write this week's copy",
        disabled: !state.settings.apiKey,
        onclick: startRun,
      })
    );
    if (state.runs.length) {
      runCard.appendChild(
        el("p", { class: "small muted center", style: "margin-top:9px", text: `Last run: ${formatDate(state.runs[0].startDate)}, ${countPosts(state.runs[0])} posts. It will avoid repeating those hooks.` })
      );
    }
  }
  view.appendChild(runCard);
}

function stepper(value, min, max, onChange) {
  const wrap = el("div", { class: "stepper" });
  const label = el("span", { class: "n", text: String(value) });
  const dec = el("button", {
    type: "button", text: "−", "aria-label": "Fewer",
    onclick: () => { const n = Math.max(min, Number(label.textContent) - 1); label.textContent = String(n); onChange(n); },
  });
  const inc = el("button", {
    type: "button", text: "+", "aria-label": "More",
    onclick: () => { const n = Math.min(max, Number(label.textContent) + 1); label.textContent = String(n); onChange(n); },
  });
  wrap.append(dec, label, inc);
  return wrap;
}

async function startRun() {
  const s = state.settings;
  state.running = true;
  state.controller = new AbortController();
  state.progress = { stage: "Starting", detail: "", pct: 0.02, log: [] };
  render();

  const totalChunks = s.platforms.length * s.dayCount;
  let written = 0;

  try {
    const run = await runWeek({
      apiKey: s.apiKey,
      model: s.model,
      platforms: s.platforms,
      dayCount: s.dayCount,
      startDate: s.startDate || todayISO(),
      notes: s.notes,
      history: historyFor(state.runs),
      settings: s,
      signal: state.controller.signal,
      onStage: (stage, detail) => {
        const labels = { signals: "Reading the room", plan: "Laying out the week", write: "Writing" };
        state.progress.stage = labels[stage] || stage;
        state.progress.detail = detail || "";
        if (stage === "signals") state.progress.pct = 0.08;
        else if (stage === "plan") state.progress.pct = 0.2;
        else {
          const m = /^(\d+) of (\d+)/.exec(detail || "");
          if (m) {
            written = Number(m[1]);
            state.progress.pct = 0.25 + 0.72 * (written / Number(m[2] || totalChunks));
          }
        }
        render();
      },
      onNote: (line) => {
        state.progress.log.push(line);
        render();
      },
    });

    state.runs = saveRun(run);
    state.currentRunId = run.id;
    state.running = false;
    state.controller = null;

    const failed = runErrors(run);
    if (failed.length) {
      toast(`${countPosts(run)} posts written, ${failed.length} batch${failed.length === 1 ? "" : "es"} failed`, "err");
    } else {
      toast(`${countPosts(run)} posts ready`);
    }
    location.hash = "#results";
    render();
  } catch (err) {
    state.running = false;
    state.controller = null;
    if (err && err.name === "AbortError") {
      toast("Stopped");
    } else {
      state.progress.log.push(err.message || String(err));
      toast(err.message || "The run failed", "err");
    }
    render();
  }
}

// ----------------------------------------------------------- results tab

function renderResults() {
  const run = state.currentRunId ? getRun(state.currentRunId) : state.runs[0];
  if (!run) {
    view.appendChild(
      el("div", { class: "empty" }, [
        el("div", { class: "big", text: "✒️" }),
        el("p", { text: "Nothing written yet." }),
        el("p", { class: "small", style: "margin-top:8px", text: "Head to Write and run a week." }),
      ])
    );
    return;
  }

  const failed = runErrors(run);

  const head = el("div", { class: "card" }, [
    el("div", { class: "row" }, [
      el("h2", { style: "margin:0", text: `Week of ${formatDate(run.startDate)}` }),
      el("span", { class: "spacer" }),
      el("span", { class: "pill accent", text: `${countPosts(run)} posts` }),
    ]),
    run.weekTheme ? el("p", { style: "margin-top:8px; font-weight:600", text: run.weekTheme }) : null,
    run.rationale ? el("p", { class: "small muted", style: "margin-top:6px", text: run.rationale }) : null,
  ]);

  const actions = el("div", { class: "row", style: "margin-top:12px" }, [
    copyButton("Copy whole week", () => runText(run, state.settings), { className: "copy primary" }),
    el("button", {
      class: "quiet",
      text: "Download",
      onclick: () => download(`pi-warriors-${run.startDate}.txt`, runText(run, state.settings)),
    }),
  ]);
  head.appendChild(actions);
  view.appendChild(head);

  if (failed.length) {
    view.appendChild(
      el("div", { class: "card" }, [
        el("h3", { class: "err", text: `${failed.length} batch${failed.length === 1 ? "" : "es"} did not finish` }),
        ...failed.map((f) =>
          el("p", { class: "small muted", text: `${PLATFORMS[f.platform].name} on ${formatDate(f.day.date)}: ${f.error}` })
        ),
      ])
    );
  }

  // Per-platform copy, useful when scheduling one platform at a time.
  const byPlatform = el("div", { class: "card" }, [el("h3", { text: "Copy one platform at a time" })]);
  const platRow = el("div", { class: "row" });
  for (const id of run.platforms || []) {
    platRow.appendChild(copyButton(PLATFORMS[id].name, () => platformText(run, id, state.settings)));
  }
  byPlatform.appendChild(platRow);
  view.appendChild(byPlatform);

  if (run.signals) {
    view.appendChild(
      el("details", {}, [
        el("summary", { text: "This week's research briefing" }),
        el("div", { class: "body", text: run.signals }),
      ])
    );
  }

  for (const day of run.days || []) {
    const posts = postsForDay(run, day.date);
    if (!posts.length) continue;

    const dayHead = el("div", { class: "day-head" }, [
      el("h2", { text: formatDate(day.date) }),
      el("span", { class: "spacer" }),
      copyButton("Day", () => dayText(run, day, state.settings)),
    ]);
    if (day.theme) dayHead.appendChild(el("span", { class: "day-theme", text: day.theme }));
    view.appendChild(dayHead);

    const groups = groupByPlatform(posts);
    for (const [platformId, list] of groups) {
      list.forEach((post, i) => view.appendChild(renderPost(post, platformId, i + 1, day)));
    }
  }
}

function renderPost(post, platformId, index, day) {
  const p = PLATFORMS[platformId];
  const check = post._check || {};
  const card = el("div", { class: "post" });

  const counterClass =
    check.remaining < 0 ? "counter over" : check.remaining < check.limit * 0.08 ? "counter tight" : "counter";

  const pillar = PILLARS.find((x) => x.id === post.pillar);

  card.appendChild(
    el("div", { class: "post-head" }, [
      el("span", { class: "pill accent", text: p.name }),
      el("span", { class: "pill", text: `#${index}` }),
      post.slot ? el("span", { class: "pill pillar", text: post.slot }) : null,
      pillar ? el("span", { class: "pill pillar", text: pillar.name }) : null,
      el("span", { class: "spacer" }),
      el("span", { class: counterClass, text: `${check.used}/${check.limit}` }),
    ])
  );

  card.appendChild(el("div", { class: "post-body", text: bodyText(post) }));

  const tags = tagText(post, state.settings.tagSeparator);
  const tagSection = el("div", { class: "post-section" }, [
    el("h4", { text: "Hashtags and tags" }),
    tags ? el("div", { class: "tagline", text: tags }) : el("p", { class: "small muted", text: "None for this one." }),
  ]);
  if (tags) {
    tagSection.appendChild(
      el("div", { class: "row" }, [
        copyButton("Copy tags", () => tagText(post, state.settings.tagSeparator)),
        el("span", { class: "small muted", text: `${check.hashtagCount} hashtag${check.hashtagCount === 1 ? "" : "s"}` }),
      ])
    );
  }
  card.appendChild(tagSection);

  const media = post.media || {};
  const mediaSection = el("div", { class: "post-section" }, [el("h4", { text: `Media — ${media.kind || "image"}` })]);
  if (media.concept) mediaSection.appendChild(el("p", { class: "media-line", text: media.concept }));
  if (media.direction) mediaSection.appendChild(el("p", { class: "media-line" }, [el("b", { text: "Shoot: " }), media.direction]));
  if (media.onScreenText) mediaSection.appendChild(el("p", { class: "media-line" }, [el("b", { text: "On screen: " }), media.onScreenText]));
  if (media.altText) mediaSection.appendChild(el("p", { class: "media-line" }, [el("b", { text: "Alt: " }), media.altText]));
  mediaSection.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [copyButton("Copy media brief", () => mediaText(post))]));
  card.appendChild(mediaSection);

  const flags = [];
  for (const note of check.trimmed || []) flags.push(note);
  for (const note of check.residual || []) flags.push(note);
  for (const w of check.warnings || []) flags.push(`Reads slightly off: ${w}`);
  if (flags.length) {
    card.appendChild(el("div", { class: "flags" }, flags.map((f) => el("div", { text: f }))));
  }

  card.appendChild(
    el("div", { class: "post-actions" }, [
      copyButton("Copy post", () => bodyText(post), { className: "copy primary" }),
      copyButton("Post + tags", () => fullText(post, state.settings)),
    ])
  );

  return card;
}

// ----------------------------------------------------------- history tab

function renderHistory() {
  if (!state.runs.length) {
    view.appendChild(
      el("div", { class: "empty" }, [el("div", { class: "big", text: "🗂️" }), el("p", { text: "No past runs yet." })])
    );
    return;
  }

  for (const run of state.runs) {
    const card = el("div", { class: "card" }, [
      el("div", { class: "row" }, [
        el("h2", { style: "margin:0", text: formatDate(run.startDate) }),
        el("span", { class: "spacer" }),
        el("span", { class: "pill", text: `${countPosts(run)}` }),
      ]),
      run.weekTheme ? el("p", { class: "small", style: "margin-top:6px", text: run.weekTheme }) : null,
      el("p", { class: "small muted", style: "margin-top:4px", text: `${(run.platforms || []).map((p) => PLATFORMS[p].name).join(", ")} · ${run.dayCount} days` }),
      el("div", { class: "row", style: "margin-top:10px" }, [
        el("button", {
          class: "quiet",
          text: "Open",
          onclick: () => {
            state.currentRunId = run.id;
            location.hash = "#results";
          },
        }),
        copyButton("Copy", () => runText(run, state.settings)),
        el("span", { class: "spacer" }),
        el("button", {
          class: "danger",
          text: "Delete",
          onclick: () => {
            if (!confirm("Delete this run?")) return;
            state.runs = deleteRun(run.id);
            if (state.currentRunId === run.id) state.currentRunId = state.runs[0] ? state.runs[0].id : null;
            render();
          },
        }),
      ]),
    ]);
    view.appendChild(card);
  }
}

// ---------------------------------------------------------- settings tab

function renderSettings() {
  const s = state.settings;

  const keyCard = el("div", { class: "card" }, [
    el("h2", { text: "Anthropic API key" }),
    el("input", {
      type: "password",
      placeholder: "sk-ant-...",
      value: s.apiKey,
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      oninput: (e) => {
        state.settings.apiKey = e.target.value.trim();
      },
      onchange: persist,
    }),
    el("p", { class: "small muted", style: "margin-top:8px", text: "The key is stored on this phone only and is sent straight to Anthropic. Nothing passes through any other server. Anyone who can unlock this phone can read it, so use a key you can rotate." }),
  ]);

  const status = el("p", { class: "small muted", style: "margin-top:10px" });
  keyCard.appendChild(
    el("button", {
      class: "wide quiet",
      style: "margin-top:10px",
      text: "Test the connection",
      onclick: async (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        status.textContent = "Checking...";
        status.className = "small muted";
        try {
          const reply = await testConnection(state.settings.apiKey, state.settings.model);
          status.textContent = `Working. The model replied "${reply}".`;
          status.className = "small ok";
        } catch (err) {
          status.textContent = err.message || String(err);
          status.className = "small err";
        }
        button.disabled = false;
      },
    })
  );
  keyCard.appendChild(status);
  view.appendChild(keyCard);

  const modelCard = el("div", { class: "card" }, [el("h2", { text: "Model" })]);
  const select = el("select", {
    onchange: (e) => {
      state.settings.model = e.target.value;
      persist();
      render();
    },
  });
  for (const m of MODELS) {
    select.appendChild(el("option", { value: m.id, text: `${m.name} — ${m.note}`, selected: m.id === s.model }));
  }
  modelCard.appendChild(select);
  view.appendChild(modelCard);

  const rules = el("div", { class: "card" }, [el("h2", { text: "Platform rules" })]);
  rules.appendChild(
    checkbox("X Premium account (25,000 characters)", s.xPremium, (on) => {
      state.settings.xPremium = on;
      persist();
    })
  );
  rules.appendChild(
    checkbox("Instagram hashtags go in the first comment", s.igHashtagsInComment, (on) => {
      state.settings.igHashtagsInComment = on;
      persist();
    })
  );
  rules.appendChild(
    checkbox("Allow long Facebook posts (past 1,500 characters)", s.facebookLongForm, (on) => {
      state.settings.facebookLongForm = on;
      persist();
    })
  );
  const sepField = el("div", { class: "field" }, [el("span", { text: "Tag separator" })]);
  const sepSelect = el("select", {
    onchange: (e) => {
      state.settings.tagSeparator = e.target.value;
      persist();
    },
  });
  for (const [value, label] of [[", ", "Comma and space"], [",", "Comma"], [" ", "Space"]]) {
    sepSelect.appendChild(el("option", { value, text: label, selected: s.tagSeparator === value }));
  }
  sepField.appendChild(sepSelect);
  rules.appendChild(sepField);
  rules.appendChild(
    el("p", { class: "small muted", style: "margin-top:8px", text: "The separator only changes how tags are displayed and copied from the tags button. The Post + tags button always uses spaces, because that is what the composers parse." })
  );
  view.appendChild(rules);

  const bytes = storageUsage();
  const dataCard = el("div", { class: "card" }, [
    el("h2", { text: "Stored on this phone" }),
    el("p", { class: "small muted", text: `${state.runs.length} run${state.runs.length === 1 ? "" : "s"} kept${bytes !== null ? `, about ${Math.round(bytes / 1024)} KB` : ""}. The last eight are held so each new week can avoid repeating itself.` }),
    el("div", { class: "row", style: "margin-top:10px" }, [
      el("button", {
        class: "danger",
        text: "Erase everything",
        onclick: () => {
          if (!confirm("Erase the API key and every saved run from this phone?")) return;
          localStorage.clear();
          state.settings = loadSettings();
          state.runs = [];
          state.currentRunId = null;
          toast("Erased");
          render();
        },
      }),
    ]),
  ]);
  view.appendChild(dataCard);

  view.appendChild(
    el("p", { class: "small muted center", style: "padding:6px 0 12px", text: "PI Warriors Copy Studio" })
  );
}

function checkbox(label, checked, onChange) {
  const input = el("input", { type: "checkbox", checked: checked ? "checked" : null, onchange: (e) => onChange(e.target.checked) });
  return el("label", { class: "check" }, [input, el("span", { text: label })]);
}

// -------------------------------------------------------------------- boot

if (!state.settings.startDate) {
  state.settings.startDate = todayISO();
  persist();
}

render();
