// Everything lives in this device's local storage. There is no server and no
// account, which is also why the API key never leaves the phone.

const SETTINGS_KEY = "piw.settings.v1";
const RUNS_KEY = "piw.runs.v1";

// Weekly runs are large. Keeping the last eight is enough to stop the generator
// repeating itself without filling the storage quota.
const MAX_RUNS = 8;

export const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "claude-opus-5",
  platforms: ["linkedin", "instagram", "facebook", "x"],
  dayCount: 7,
  perDay: { linkedin: 1, instagram: 3, facebook: 3, x: 6 },
  xPremium: false,
  facebookLongForm: false,
  igHashtagsInComment: false,
  tagSeparator: ", ",
  notes: "",
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota is the realistic failure here, and it matters enough to surface.
    return false;
  }
}

export function loadSettings() {
  const stored = read(SETTINGS_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    perDay: { ...DEFAULT_SETTINGS.perDay, ...(stored.perDay || {}) },
  };
}

export function saveSettings(settings) {
  return write(SETTINGS_KEY, settings);
}

export function loadRuns() {
  const runs = read(RUNS_KEY, []);
  return Array.isArray(runs) ? runs : [];
}

export function saveRun(run) {
  const runs = loadRuns().filter((r) => r.id !== run.id);
  runs.unshift(run);
  let trimmed = runs.slice(0, MAX_RUNS);
  // If the quota still refuses the write, drop the oldest runs until it fits.
  while (trimmed.length > 1 && !write(RUNS_KEY, trimmed)) {
    trimmed = trimmed.slice(0, trimmed.length - 1);
  }
  if (trimmed.length <= 1) write(RUNS_KEY, trimmed);
  return trimmed;
}

export function deleteRun(id) {
  const runs = loadRuns().filter((r) => r.id !== id);
  write(RUNS_KEY, runs);
  return runs;
}

export function getRun(id) {
  return loadRuns().find((r) => r.id === id) || null;
}

// What the next run needs to know about previous ones, so a weekly cadence does
// not slowly turn into the same post over and over.
export function historyFor(runs, { maxHooks = 40, maxThemes = 12 } = {}) {
  const hooks = [];
  const themes = [];
  for (const run of runs) {
    if (run.weekTheme) themes.push(`${run.startDate}: ${run.weekTheme}`);
    for (const chunk of run.chunks || []) {
      for (const post of chunk.posts || []) {
        const line = (post.hook || post.body || "").split("\n")[0].trim();
        if (line) hooks.push(line.slice(0, 120));
      }
    }
  }
  return { hooks: hooks.slice(0, maxHooks), themes: themes.slice(0, maxThemes) };
}

// Rough size report so Settings can warn before the browser starts refusing.
export function storageUsage() {
  let bytes = 0;
  try {
    for (const key of [SETTINGS_KEY, RUNS_KEY]) {
      const raw = localStorage.getItem(key);
      if (raw) bytes += raw.length * 2;
    }
  } catch {
    return null;
  }
  return bytes;
}
