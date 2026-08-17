// pages/timer.js — a count-up timer with laps and a countdown, for holding legs,
// timed approaches, fuel-tank switches and leg timing.

import { el, getState, setState } from '../ui.js';

const ID = 'timer';

function fmtClock(ms, showTenths = true) {
  const neg = ms < 0;
  const total = Math.abs(ms);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const sec = Math.floor((total % 60000) / 1000);
  const t = Math.floor((total % 1000) / 100);
  const p = (n) => String(n).padStart(2, '0');
  const core = h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  return (neg ? '−' : '') + core + (showTenths && h === 0 ? `.${t}` : '');
}

export function renderTimer() {
  const s = getState(ID);
  s.laps ||= [];

  const root = el('div', { class: 'page' });

  // ---- Stopwatch ----------------------------------------------------------
  let running = false, startedAt = 0, elapsed = 0, raf = null;
  const display = el('div', { class: 'timer-display' }, '00:00.0');
  const lapList = el('div', { class: 'lap-list' });

  const drawLaps = () => {
    lapList.replaceChildren();
    s.laps.slice().reverse().forEach((lap, i) => {
      const n = s.laps.length - i;
      lapList.append(el('div', { class: 'lap' },
        el('span', {}, `Leg ${n}`),
        el('span', {}, fmtClock(lap.split)),
        el('span', { class: 'dim' }, fmtClock(lap.total))));
    });
  };

  const tick = () => {
    const now = running ? elapsed + (performance.now() - startedAt) : elapsed;
    display.textContent = fmtClock(now);
    if (running) raf = requestAnimationFrame(tick);
  };

  const startStop = el('button', { class: 'btn big primary', type: 'button' }, 'Start');
  const lapBtn = el('button', { class: 'btn big', type: 'button' }, 'Lap');
  const resetBtn = el('button', { class: 'btn big', type: 'button' }, 'Reset');

  startStop.addEventListener('click', () => {
    if (running) {
      elapsed += performance.now() - startedAt;
      running = false;
      startStop.textContent = 'Start';
      startStop.classList.remove('running');
      cancelAnimationFrame(raf);
      tick();
    } else {
      startedAt = performance.now();
      running = true;
      startStop.textContent = 'Stop';
      startStop.classList.add('running');
      tick();
    }
  });
  lapBtn.addEventListener('click', () => {
    const total = running ? elapsed + (performance.now() - startedAt) : elapsed;
    const prev = s.laps.length ? s.laps[s.laps.length - 1].total : 0;
    s.laps.push({ total, split: total - prev });
    setState(ID, 'laps', s.laps);
    drawLaps();
  });
  resetBtn.addEventListener('click', () => {
    running = false; elapsed = 0; startedAt = 0;
    cancelAnimationFrame(raf);
    startStop.textContent = 'Start';
    startStop.classList.remove('running');
    s.laps = []; setState(ID, 'laps', s.laps);
    drawLaps();
    display.textContent = '00:00.0';
  });

  // ---- Countdown ----------------------------------------------------------
  let cdRunning = false, cdEnd = 0, cdRemaining = 60000, cdTimer = null;
  const cdDisplay = el('div', { class: 'timer-display alt' }, '01:00.0');
  const cdStatus = el('div', { class: 'timer-status' }, '');

  const cdTick = () => {
    const rem = cdRunning ? cdEnd - performance.now() : cdRemaining;
    cdDisplay.textContent = fmtClock(rem);
    cdDisplay.classList.toggle('expired', rem <= 0);
    if (rem <= 0 && cdRunning) {
      cdStatus.textContent = 'Time.';
      beep();
      cdRunning = false;
      cdStart.textContent = 'Start';
      cdRemaining = 0;
      return;
    }
    if (cdRunning) cdTimer = requestAnimationFrame(cdTick);
  };

  const preset = (label, ms) => {
    const b = el('button', { class: 'chip', type: 'button' }, label);
    b.addEventListener('click', () => {
      cdRunning = false; cancelAnimationFrame(cdTimer);
      cdRemaining = ms; cdStatus.textContent = '';
      cdStart.textContent = 'Start';
      cdDisplay.classList.remove('expired');
      cdTick();
    });
    return b;
  };

  const cdStart = el('button', { class: 'btn big primary', type: 'button' }, 'Start');
  cdStart.addEventListener('click', () => {
    if (cdRunning) {
      cdRemaining = cdEnd - performance.now();
      cdRunning = false;
      cdStart.textContent = 'Start';
      cancelAnimationFrame(cdTimer);
      cdTick();
    } else {
      if (cdRemaining <= 0) cdRemaining = 60000;
      cdEnd = performance.now() + cdRemaining;
      cdRunning = true;
      cdStatus.textContent = '';
      cdStart.textContent = 'Pause';
      cdTick();
    }
  });

  root.append(
    el('div', { class: 'card' },
      el('h3', { class: 'card-title' }, 'Elapsed time'),
      display,
      el('div', { class: 'btn-row' }, startStop, lapBtn, resetBtn),
      lapList),
    el('div', { class: 'card' },
      el('h3', { class: 'card-title' }, 'Countdown'),
      cdDisplay, cdStatus,
      el('div', { class: 'chips' },
        preset('1:00 leg', 60000),
        preset('1:30 leg', 90000),
        preset('2:00', 120000),
        preset('5:00', 300000),
        preset('30 sec', 30000)),
      el('div', { class: 'btn-row' }, cdStart)),
    el('div', { class: 'note' }, 'Standard holding legs are one minute at or below 14 000 ft and one and a half minutes above. Timing starts abeam the fix outbound, or wings level after the turn, whichever comes later.'),
  );

  drawLaps();
  return root;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(); osc.stop(ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 900);
  } catch { /* audio blocked; the visual cue still fires */ }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}
