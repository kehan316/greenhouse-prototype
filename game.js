'use strict';
// Twilight Greenhouse — Night Shift prototype
// CSC 486B Assignment 3 · Kehan Wang
//
// Design question: after the "While You Slept" recap, can the Night Keeper tell
// what their partner did, and do they use what the partner left behind?
// The Day Keeper (Sol) is scripted and the time between shifts is simulated.
//
// URL options:  ?feel=off   -> "before" version of the gift-opening feel pass
//               ?recap=noskip | text   -> recap variants (default: animated + skippable)

const params = new URLSearchParams(location.search);
const CONFIG = {
  feel: params.get('feel') !== 'off',
  recap: ['anim', 'noskip', 'text'].includes(params.get('recap')) ? params.get('recap') : 'anim',
  recapStepMs: 3000,
  shiftSeconds: 150,
  slugStart: 35,
  slugEnd: 60,
};

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

const S = {
  mode: 'login',          // login | recap | journal | night | handover | done
  paused: true,
  t: 0,                   // seconds into the night shift
  selected: null,         // 'moth' | 'eggshells' | null
  inv: { dew: 0, leaves: 0, compost: 0, gift: 'wrapped', eggshells: 0 },
  dews: [],
  slugs: [],
  moth: null,
  dewTimer: 1.5,
  slugEvent: 'pending',   // pending | active | done
  slugTimer: 0,
  recapSkipped: false,
  giftEnt: null,
};

// ---------------------------------------------------------------------------
// Playtest metrics (shown on the results screen, copyable as JSON)
// ---------------------------------------------------------------------------

const T0 = performance.now();
const sessionSecs = () => +((performance.now() - T0) / 1000).toFixed(1);
const shiftSecs = () => +S.t.toFixed(1);

const M = {
  tester: '',
  date: new Date().toISOString(),
  variant: {},
  recap: { seconds: 0, skipped: false, stepReached: 0, steps: 0 },
  journal: { firstReadSeconds: 0, reopens: 0 },
  gift: { openedWhere: null, openedAtShiftS: null, firstUseShiftS: null, uses: 0 },
  shift: {
    firstAction: null, firstActionS: null, leavesTakenS: null,
    leaves: 0, compost: 0, dew: 0, bloomed: 0, nibbled: 0,
    slugsPicked: 0, slugsRepelled: 0, endedEarly: false, lengthS: 0,
  },
  handover: { note: '', giftPacked: null },
  recall: { hits: 0, of: 0, falseAlarms: 0, picked: [] },
  log: [],
};

function logEvent(name, data) {
  M.log.push({ t: sessionSecs(), shift: S.mode === 'night' ? shiftSecs() : null, e: name, ...(data || {}) });
}

function firstAction(name) {
  if (M.shift.firstAction) return;
  M.shift.firstAction = name;
  M.shift.firstActionS = shiftSecs();
}

// ---------------------------------------------------------------------------
// Feel pass: everything that makes opening Sol's gift feel good lives here.
// With ?feel=off none of it runs and the gift simply swaps to its contents.
// ---------------------------------------------------------------------------

const FX = {
  audio: null,

  ctx() {
    if (!this.audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.audio = new AC();
    }
    return this.audio;
  },

  tone(freq, start, dur, type, vol, endFreq) {
    const ctx = this.ctx();
    if (!ctx) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  },

  // soft "pop" as the lid comes off
  pop() { this.tone(320, 0, 0.14, 'sine', 0.25, 120); },

  // warm rising arpeggio for the reveal
  chime() {
    [659.25, 783.99, 987.77, 1318.51].forEach((f, i) => this.tone(f, 0.05 + i * 0.08, 0.9, 'triangle', 0.12));
  },

  // little rising tick while the box squashes (anticipation)
  windup() { this.tone(500, 0, 0.16, 'sine', 0.06, 900); },

  burst(cx, cy, chars, count) {
    const layer = $('#fx-layer');
    for (let i = 0; i < count; i++) {
      const p = el('span', 'particle', chars[i % chars.length]);
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      layer.append(p);
      const ang = rand(0, Math.PI * 2);
      const dist = rand(60, 150);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist - 40;
      const spin = rand(-180, 180);
      p.animate([
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin}deg) scale(1)`, opacity: 1, offset: 0.6 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 50}px)) rotate(${spin * 1.4}deg) scale(.8)`, opacity: 0 },
      ], { duration: rand(800, 1200), easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => p.remove();
    }
  },

  glow(cx, cy) {
    const app = $('#app').getBoundingClientRect();
    const g = el('div', 'glow-pulse');
    g.style.setProperty('--gx', ((cx / app.width) * 100).toFixed(1) + '%');
    g.style.setProperty('--gy', ((cy / app.height) * 100).toFixed(1) + '%');
    $('#fx-layer').append(g);
    setTimeout(() => g.remove(), 1000);
  },
};

function centerInApp(node) {
  const a = $('#app').getBoundingClientRect();
  const r = node.getBoundingClientRect();
  return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 };
}

// ---------------------------------------------------------------------------
// Scene: plots + moving entities
// ---------------------------------------------------------------------------

const scene = $('#scene');

const PLOTS = [
  { id: 'sunA', kind: 'sun', x: 18, y: 57, state: 'bud' },
  { id: 'moonA', kind: 'moon', x: 50, y: 57, state: 'dry' },
  { id: 'sunB', kind: 'sun', x: 82, y: 57, state: 'empty' },
  { id: 'basket', kind: 'basket', x: 18, y: 83, state: 0 },
  { id: 'moonB', kind: 'moon', x: 50, y: 83, state: 'dry' },
  { id: 'log', kind: 'log', x: 82, y: 83, state: 'idle' },
];
const plots = {};

const SPRITES = {
  sun: {
    empty: ['', 'empty soil'],
    sprout: ['🌱', 'sunflower seedling'],
    bud: ['🌿', 'sunflower bud'],
    bloom: ['🌻', 'sunflower'],
  },
  moon: {
    dry: ['🌱', 'moonflower bud'],
    watered: ['🌱', 'moonflower bud 💧'],
    ready: ['🌷', 'ready to open'],
    bloom: ['💮', 'moonflower'],
    nibbled: ['🥀', 'nibbled'],
  },
};

function buildScene() {
  scene.innerHTML = '';
  for (const def of PLOTS) {
    const p = { ...def, protected: false, trail: false };
    p.node = el('div', 'plot');
    p.node.dataset.plot = p.id;
    p.sprite = el('div', 'sprite');
    p.label = el('div', 'label');
    p.node.append(p.sprite, p.label);
    p.node.style.left = p.x + '%';
    p.node.style.top = p.y + '%';
    scene.append(p.node);
    plots[p.id] = p;
    paintPlot(p);
  }
}

function paintPlot(p) {
  let sprite;
  let label;
  if (p.kind === 'basket') {
    sprite = '🧺';
    label = p.state > 0 ? `Sol's leaves ×${p.state}` : 'leaf basket';
  } else if (p.kind === 'log') {
    sprite = '🪵';
    label = 'mushroom log 🍄';
  } else {
    [sprite, label] = SPRITES[p.kind][p.state];
  }
  p.sprite.textContent = sprite;
  p.label.textContent = label;
  p.node.classList.toggle('ready', p.kind === 'moon' && p.state === 'ready');
  p.node.classList.toggle('protected', p.protected);
  p.node.classList.toggle('trail', p.trail);
  p.node.classList.toggle('sleeping', p.kind === 'sun' && S.mode === 'night');
  p.node.classList.toggle('has-leaves', p.kind === 'basket' && p.state > 0);
}

function bump(p) {
  p.sprite.animate(
    [{ transform: 'scale(.4)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
    { duration: 500, easing: 'ease-out' },
  );
}

function setPlot(id, state) {
  const p = plots[id];
  p.state = state;
  paintPlot(p);
  bump(p);
}

function spawnEnt(cls, emoji, x, y) {
  const node = el('div', 'ent ' + cls, `<span>${emoji}</span>`);
  place(node, x, y);
  scene.append(node);
  return node;
}

function place(node, x, y) {
  node.style.left = x + '%';
  node.style.top = y + '%';
}

function setSky(name) { scene.dataset.sky = name; }

function setClock(text) { $('#clock').textContent = text; }

function setPhase(text) { $('#phase').textContent = text; }

let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------------------
// Overlay panels
// ---------------------------------------------------------------------------

function showPanel(html) {
  $('#panel').innerHTML = html;
  $('#overlay').classList.remove('hidden');
  $('#panel').scrollTop = 0;
  return $('#panel');
}

function hidePanel() { $('#overlay').classList.add('hidden'); }

// ---------------------------------------------------------------------------
// 1. Login
// ---------------------------------------------------------------------------

function showLogin() {
  setSky('dusk');
  setClock('18:00');
  setPhase('Twilight Greenhouse');
  const panel = showPanel(`
    <h1>Twilight Greenhouse</h1>
    <p class="sub">Night Keeper prototype · CSC 486B Assignment 3 · Kehan Wang</p>
    <div class="notif"><b>☀️ Sol</b> handed over the greenhouse<br><span>“Your turn, Night Keeper! 🌙”</span><small>18:00</small></div>
    <p>You and Sol share a greenhouse but live on opposite sides of the world. Sol tends it by day while you sleep; you tend it by night while Sol sleeps.</p>
    <label class="field">Tester ID (optional)<input id="tester" placeholder="e.g. T1" autocomplete="off"></label>
    <button class="primary" id="go">Open the greenhouse 🌙</button>
    <details>
      <summary>Tester settings</summary>
      <div><b>Feel pass</b>
        <label><input type="radio" name="feel" value="on"> On (after)</label>
        <label><input type="radio" name="feel" value="off"> Off (before)</label>
      </div>
      <div><b>Recap</b>
        <label><input type="radio" name="recap" value="anim"> Animated, skippable</label>
        <label><input type="radio" name="recap" value="noskip"> Animated, no skip</label>
        <label><input type="radio" name="recap" value="text"> Text summary only</label>
      </div>
    </details>
  `);
  panel.querySelector(`input[name=feel][value=${CONFIG.feel ? 'on' : 'off'}]`).checked = true;
  panel.querySelector(`input[name=recap][value=${CONFIG.recap}]`).checked = true;
  panel.querySelector('#go').onclick = () => {
    CONFIG.feel = panel.querySelector('input[name=feel]:checked').value === 'on';
    CONFIG.recap = panel.querySelector('input[name=recap]:checked').value;
    M.tester = panel.querySelector('#tester').value.trim();
    M.variant = { feel: CONFIG.feel ? 'on' : 'off', recap: CONFIG.recap };
    if (CONFIG.feel) FX.ctx(); // unlock audio on a user gesture
    logEvent('login', M.variant);
    hidePanel();
    runRecap();
  };
}

// ---------------------------------------------------------------------------
// 2. "While You Slept" recap — Sol's scripted day, replayed as a time-lapse
// ---------------------------------------------------------------------------

const RECAP = [
  { time: '06:40', sky: 'dawn', text: 'Sol logged in ☀️', act() {} },
  {
    time: '07:15', sky: 'day',
    text: 'Sol watered your moonflower buds with the dew you collected last night 💧',
    act() { setPlot('moonA', 'watered'); setPlot('moonB', 'watered'); },
  },
  { time: '09:00', text: 'Sol planted a new sunflower seed 🌱', act() { setPlot('sunB', 'sprout'); } },
  {
    time: '11:30',
    text: 'Sol guided the bees to pollinate the sunflowers 🐝',
    act() {
      beeFlight();
      setTimeout(() => { setPlot('sunA', 'bloom'); setPlot('sunB', 'bud'); }, 1300);
    },
  },
  {
    time: '14:00',
    text: 'The sunflowers soaked up daylight, so your moonflower buds can open tonight ✨',
    act() { setPlot('moonA', 'ready'); setPlot('moonB', 'ready'); },
  },
  {
    time: '15:30',
    text: 'Sol raked the fallen leaves into the basket for you 🍂',
    act() { setPlot('basket', 3); },
  },
  {
    time: '17:20', sky: 'dusk',
    text: 'Sol spotted slug trails near the moonflowers 🐌',
    act() {
      for (const id of ['moonA', 'moonB']) { plots[id].trail = true; paintPlot(plots[id]); }
    },
  },
  {
    time: '17:50',
    text: 'Sol wrapped a gift 🎁 and wrote in the journal 📖',
    act() { showGiftEnt(); },
  },
];

function beeFlight() {
  const bee = spawnEnt('bee', '🐝', 5, 30);
  bee.animate([
    { left: '5%', top: '30%' },
    { left: '18%', top: '48%' },
    { left: '50%', top: '30%' },
    { left: '82%', top: '48%' },
    { left: '105%', top: '25%' },
  ], { duration: 2600, easing: 'ease-in-out' }).onfinish = () => bee.remove();
}

function showGiftEnt() {
  if (S.giftEnt) return;
  S.giftEnt = spawnEnt('gift-ent', '🎁', 50, 28);
  S.giftEnt.animate([{ transform: 'translate(-50%,-50%) scale(0)' }, { transform: 'translate(-50%,-50%) scale(1)' }],
    { duration: 450, easing: 'ease-out' });
}

// Final state after Sol's day, used when the recap is skipped or text-only.
function applyRecapEndState() {
  const final = { sunA: 'bloom', sunB: 'bud', moonA: 'ready', moonB: 'ready', basket: 3 };
  for (const [id, state] of Object.entries(final)) { plots[id].state = state; }
  plots.moonA.trail = plots.moonB.trail = true;
  Object.values(plots).forEach(paintPlot);
  scene.querySelectorAll('.bee').forEach((b) => b.remove());
  showGiftEnt();
}

async function runRecap() {
  S.mode = 'recap';
  setPhase('While you slept… (Sol\'s day)');
  M.recap.steps = RECAP.length;
  const started = performance.now();
  const finishRecap = () => {
    M.recap.seconds = +((performance.now() - started) / 1000).toFixed(1);
    logEvent('recap_done', { ...M.recap });
    $('#caption').classList.add('hidden');
    showJournal(true);
  };

  if (CONFIG.recap === 'text') {
    applyRecapEndState();
    setClock('18:00');
    setSky('dusk');
    M.recap.stepReached = RECAP.length;
    const items = RECAP.map((s) => `<li><b>${s.time}</b> ${s.text}</li>`).join('');
    const panel = showPanel(`
      <h2>While you slept… ☀️</h2>
      <p class="sub">Sol's day in the greenhouse</p>
      <ul class="list">${items}</ul>
      <button class="primary" id="next">Read Sol's journal 📖</button>`);
    panel.querySelector('#next').onclick = () => { hidePanel(); finishRecap(); };
    return;
  }

  const cap = $('#caption');
  cap.classList.remove('hidden');
  cap.innerHTML = `
    <div class="head">While you slept…</div>
    <div class="row"><div class="text"></div>
      ${CONFIG.recap === 'anim' ? '<button class="ghost" id="skip">Skip ⏭</button>' : ''}</div>
    <div class="progress"><div></div></div>`;
  const textEl = cap.querySelector('.text');
  const bar = cap.querySelector('.progress div');
  const skip = cap.querySelector('#skip');
  if (skip) {
    skip.onclick = () => {
      S.recapSkipped = true;
      M.recap.skipped = true;
      logEvent('recap_skip', { atStep: M.recap.stepReached });
    };
  }

  for (let i = 0; i < RECAP.length && !S.recapSkipped; i++) {
    const step = RECAP[i];
    M.recap.stepReached = i + 1;
    setClock(step.time);
    if (step.sky) setSky(step.sky);
    textEl.style.opacity = 0;
    await sleep(150);
    textEl.textContent = step.text;
    textEl.style.opacity = 1;
    bar.style.width = ((i + 1) / RECAP.length) * 100 + '%';
    step.act();
    const until = performance.now() + CONFIG.recapStepMs;
    while (performance.now() < until && !S.recapSkipped) await sleep(50);
  }

  applyRecapEndState();
  setClock('18:00');
  setSky('dusk');
  bar.style.width = '100%';
  cap.querySelector('.head').textContent = '18:00 · Handover';
  textEl.textContent = 'Sol handed the greenhouse over to you. Good evening, Night Keeper 🌙';
  if (skip) skip.remove();
  const next = el('button', 'small-btn', 'Read Sol\'s journal 📖');
  cap.querySelector('.row').append(next);
  next.onclick = finishRecap;
}

// ---------------------------------------------------------------------------
// 3. Journal + gift
// ---------------------------------------------------------------------------

const JOURNAL_HTML = `
  <div class="journal">
    <p>Good morning! (well… good evening for you 🌙)</p>
    <p>Thank you for the dew last night, the moonflower buds drank all of it. The sunflowers had a sunny day, so your buds should be ready to open tonight.</p>
    <p>I raked the fallen leaves into the basket for your mushrooms 🍂</p>
    <p>I saw slug trails near the moonflowers… so I packed something that might help. Sleep well when you're done!</p>
    <p class="sig">— Sol ☀️🌻</p>
  </div>`;

const ITEM_CARD_HTML = `
  <div class="item-card">
    <div class="item-emoji">🥚</div>
    <b>Crushed eggshells ×2</b>
    <p>Saved from Sol's breakfast. Slugs won't cross a ring of eggshells.</p>
  </div>`;

function giftZoneHtml() {
  if (S.inv.gift === 'wrapped') {
    return `<div class="gift-zone">
      <button class="gift-box ${CONFIG.feel ? 'wiggle' : ''}" id="giftbox" aria-label="Open Sol's gift">🎁</button>
      <div class="gift-hint">Sol's gift · tap to open</div></div>`;
  }
  return `<div class="gift-zone">${ITEM_CARD_HTML}</div>`;
}

function wireGiftBox(panel, where) {
  const box = panel.querySelector('#giftbox');
  if (box) box.onclick = () => openGift(box, where);
}

function showJournal(first) {
  S.paused = true;
  if (first) S.mode = 'journal';
  const opened = performance.now();
  const panel = showPanel(`
    <h2>📖 Sol's journal</h2>
    ${JOURNAL_HTML}
    ${giftZoneHtml()}
    <button class="primary" id="close">${first ? 'Start your night shift 🌙' : 'Back to the greenhouse'}</button>`);
  wireGiftBox(panel, first ? 'journal' : 'journal-reopened');
  panel.querySelector('#close').onclick = () => {
    if (first) {
      M.journal.firstReadSeconds = +((performance.now() - opened) / 1000).toFixed(1);
      logEvent('journal_closed', { seconds: M.journal.firstReadSeconds, gift: S.inv.gift });
      hidePanel();
      startNight();
    } else {
      hidePanel();
      S.paused = false;
    }
  };
}

function showGiftPanel() {
  S.paused = true;
  const panel = showPanel(`
    <h2>🎁 Sol's gift</h2>
    ${giftZoneHtml()}
    <button class="primary" id="close">Back to the greenhouse</button>`);
  wireGiftBox(panel, 'inventory');
  panel.querySelector('#close').onclick = () => { hidePanel(); S.paused = false; };
}

async function openGift(box, where) {
  if (S.inv.gift !== 'wrapped') return;
  S.inv.gift = 'opening';
  const zone = box.parentElement;

  if (CONFIG.feel) {
    // 1. anticipation: squash down with a rising tick
    box.classList.remove('wiggle');
    FX.windup();
    await box.animate(
      [{ transform: 'scale(1,1)' }, { transform: 'scale(1.2,.78) translateY(10px)' }],
      { duration: 160, easing: 'ease-in', fill: 'forwards' },
    ).finished;
    // 2. hit-stop: hold the squash for a beat, glowing
    box.classList.add('charged');
    await sleep(170);
    // 3. release: pop, burst of petals + eggshell bits, warm glow
    const c = centerInApp(box);
    FX.pop();
    FX.chime();
    FX.glow(c.x, c.y);
    FX.burst(c.x, c.y, ['✨', '🌸', '🥚', '💛', '🌼'], 22);
    await box.animate(
      [
        { transform: 'scale(1.2,.78) translateY(10px)', opacity: 1 },
        { transform: 'scale(.85,1.3) translateY(-24px)', opacity: 1, offset: 0.4 },
        { transform: 'scale(0) translateY(-50px)', opacity: 0 },
      ],
      { duration: 280, easing: 'ease-out', fill: 'forwards' },
    ).finished;
  }

  // reveal
  zone.innerHTML = ITEM_CARD_HTML;
  if (CONFIG.feel) {
    const card = zone.querySelector('.item-card');
    card.animate(
      [{ transform: 'translateY(30px) scale(.3)', opacity: 0 }, { transform: 'translateY(0) scale(1)', opacity: 1 }],
      { duration: 560, easing: 'cubic-bezier(.34,1.56,.64,1)' },
    );
    card.querySelector('.item-emoji').animate(
      [{ transform: 'rotate(-20deg) scale(.5)' }, { transform: 'rotate(8deg) scale(1.2)', offset: 0.6 }, { transform: 'rotate(0) scale(1)' }],
      { duration: 700, easing: 'ease-out' },
    );
    card.querySelectorAll('b, p').forEach((n) => n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 250, fill: 'backwards' }));
  }

  S.inv.gift = 'opened';
  S.inv.eggshells = 2;
  M.gift.openedWhere = where;
  M.gift.openedAtShiftS = S.mode === 'night' ? shiftSecs() : 0;
  logEvent('gift_opened', { where });
  if (S.mode === 'night') renderInventory();
}

// ---------------------------------------------------------------------------
// 4. Night shift
// ---------------------------------------------------------------------------

function startNight() {
  S.mode = 'night';
  S.t = 0;
  S.paused = false;
  setSky('night');
  setPhase('Your night shift');
  if (S.giftEnt) { S.giftEnt.remove(); S.giftEnt = null; }
  Object.values(plots).forEach(paintPlot);
  S.moth = { node: spawnEnt('moth', '🦋', 50, 24), x: 50, y: 24, phase: 0, target: null, onArrive: null };
  S.moth.node.dataset.ent = 'moth';
  ['#bar', '#goals', '#btn-journal'].forEach((s) => $(s).classList.remove('hidden'));
  renderInventory();
  updateGoals();
  logEvent('shift_start');
  last = performance.now();
  requestAnimationFrame(tick);
}

function updateGoals() {
  $('#goals').textContent =
    `🌙 Moonflowers opened ${M.shift.bloomed}/2 · 🍄 Compost ${M.shift.compost} · 💧 Dew ${M.shift.dew}`;
}

function renderInventory() {
  const inv = $('#inventory');
  inv.innerHTML = '';
  const slot = (key, emoji, count, label, extra = '') => {
    const b = el('button', `slot ${extra}`, `${emoji}${count !== '' ? ' ' + count : ''}<small>${label}</small>`);
    b.dataset.slot = key;
    if (S.selected === key) b.classList.add('selected');
    inv.append(b);
  };
  slot('dew', '💧', S.inv.dew, 'dew');
  slot('leaves', '🍂', S.inv.leaves, 'leaves');
  slot('compost', '🟤', S.inv.compost, 'compost');
  if (S.inv.gift === 'opened') slot('eggshells', '🥚', S.inv.eggshells, 'eggshells');
  else slot('gift', '🎁', '', "Sol's gift", 'gift');
}

function select(what) {
  S.selected = S.selected === what ? null : what;
  S.moth.node.classList.toggle('selected', S.selected === 'moth');
  renderInventory();
}

$('#inventory').addEventListener('click', (e) => {
  const b = e.target.closest('.slot');
  if (!b || S.mode !== 'night' || S.paused) return;
  switch (b.dataset.slot) {
    case 'gift':
      logEvent('gift_slot_tap');
      showGiftPanel();
      break;
    case 'eggshells':
      if (S.inv.eggshells <= 0) { toast('No eggshells left.'); break; }
      select('eggshells');
      if (S.selected === 'eggshells') toast('Tap a moonflower to sprinkle eggshells around it.');
      break;
    case 'leaves':
      toast(S.inv.leaves > 0 ? 'The mushrooms on the log can turn leaves into compost 🍄' : 'No leaves yet.');
      break;
    case 'dew':
      toast('Fresh dew for Sol\'s morning watering 💧');
      break;
    case 'compost':
      toast('Compost for Sol\'s seedlings 🌱');
      break;
  }
});

scene.addEventListener('click', (e) => {
  if (S.mode !== 'night' || S.paused) return;
  const ent = e.target.closest('[data-ent]');
  const plotNode = e.target.closest('.plot');
  if (ent) return tapEntity(ent);
  if (plotNode) return tapPlot(plots[plotNode.dataset.plot]);
  if (S.selected) select(S.selected); // tap on empty space clears selection
});

function tapEntity(node) {
  const kind = node.dataset.ent;
  if (kind === 'moth') {
    if (S.moth.target) return;
    select('moth');
    if (S.selected === 'moth') toast('Tap a moonflower bud to guide the moth there.');
    return;
  }
  if (kind === 'dew') {
    const d = S.dews.find((x) => x.node === node);
    if (!d) return;
    S.dews.splice(S.dews.indexOf(d), 1);
    node.remove();
    S.inv.dew++;
    M.shift.dew++;
    firstAction('collect_dew');
    renderInventory();
    updateGoals();
    return;
  }
  if (kind === 'slug') {
    const s = S.slugs.find((x) => x.node === node);
    if (!s) return;
    removeSlug(s);
    M.shift.slugsPicked++;
    firstAction('pick_slug');
    logEvent('slug_picked');
  }
}

function tapPlot(p) {
  if (p.kind === 'moon') return tapMoon(p);
  if (S.selected) select(S.selected);
  if (p.kind === 'sun') {
    toast('Sol\'s sunflower is sleeping 🌻💤');
  } else if (p.kind === 'basket') {
    if (p.state > 0) {
      const n = p.state;
      S.inv.leaves += n;
      M.shift.leaves += n;
      M.shift.leavesTakenS = shiftSecs();
      p.state = 0;
      paintPlot(p);
      bump(p);
      firstAction('take_leaves');
      logEvent('leaves_taken', { n });
      toast(`You took the leaves Sol raked for you (+${n} 🍂)`);
      renderInventory();
    } else {
      toast('The basket is empty.');
    }
  } else if (p.kind === 'log') {
    if (S.inv.leaves > 0) {
      S.inv.leaves--;
      S.inv.compost++;
      M.shift.compost++;
      bump(p);
      firstAction('compost');
      logEvent('compost');
      toast('🍄 The mushrooms turned a leaf into compost (+1 🟤)');
      renderInventory();
      updateGoals();
    } else {
      toast('The mushrooms need fallen leaves to make compost.');
    }
  }
}

function tapMoon(p) {
  if (S.selected === 'eggshells') {
    if (p.state === 'nibbled') return toast('Too late for this one 🥀');
    if (p.protected) return toast('This one is already protected.');
    p.protected = true;
    paintPlot(p);
    S.inv.eggshells--;
    M.gift.uses++;
    if (M.gift.firstUseShiftS == null) M.gift.firstUseShiftS = shiftSecs();
    firstAction('use_gift');
    logEvent('gift_used', { plot: p.id });
    toast('🥚 Eggshell ring sprinkled. Slugs won\'t cross it.');
    if (S.inv.eggshells <= 0) S.selected = null;
    renderInventory();
    return;
  }
  if (S.selected === 'moth') {
    if (p.state !== 'ready') {
      select('moth');
      return toast(p.state === 'bloom' ? 'Already in bloom 🌙' : 'This one can\'t be pollinated.');
    }
    select('moth');
    guideMoth(p);
    return;
  }
  if (p.state === 'ready') toast('This bud is ready to open. It needs a moth to pollinate it.');
  else if (p.state === 'bloom') toast('A moonflower in full bloom 🌙');
  else if (p.state === 'nibbled') toast('Slugs nibbled this one 🥀');
}

function guideMoth(p) {
  firstAction('guide_moth');
  S.moth.target = { x: p.x, y: p.y - 9 };
  S.moth.onArrive = () => {
    if (p.state === 'ready') {
      p.state = 'bloom';
      paintPlot(p);
      bump(p);
      M.shift.bloomed++;
      logEvent('bloom', { plot: p.id });
      toast('🌙 A moonflower opened!');
      updateGoals();
    }
    setTimeout(() => { S.moth.target = { x: 50, y: 24, home: true }; }, 500);
  };
}

// --- dew ---

function spawnDew() {
  const d = { x: rand(10, 90), y: rand(8, 34), life: 9 };
  d.node = spawnEnt('dew', '💧', d.x, d.y);
  d.node.dataset.ent = 'dew';
  S.dews.push(d);
}

// --- slugs (the night's gentle event) ---

function aliveMoons() {
  return ['moonA', 'moonB'].map((id) => plots[id]).filter((p) => p.state !== 'nibbled');
}

function spawnSlug() {
  const targets = aliveMoons();
  if (!targets.length) return;
  const target = targets[Math.floor(Math.random() * targets.length)];
  const fromLeft = Math.random() < 0.5;
  const s = { x: fromLeft ? -6 : 106, y: target.y + rand(-4, 4), target, state: 'go', home: fromLeft ? -1 : 1 };
  s.node = spawnEnt('slug', '🐌', s.x, s.y);
  s.node.dataset.ent = 'slug';
  S.slugs.push(s);
}

function removeSlug(s) {
  S.slugs.splice(S.slugs.indexOf(s), 1);
  s.node.remove();
}

function updateSlugs(dt) {
  for (const s of [...S.slugs]) {
    if (s.state === 'go' && (s.target.state === 'nibbled' || S.slugEvent === 'done')) {
      const others = aliveMoons();
      if (others.length && S.slugEvent !== 'done') s.target = others[0];
      else s.state = 'flee';
    }
    let dx;
    if (s.state === 'flee') {
      dx = s.home * 16 * dt;
      s.x += dx;
      if (s.x < -10 || s.x > 110) { removeSlug(s); continue; }
    } else {
      const tx = s.target.x - s.x;
      const ty = s.target.y - s.y;
      const dist = Math.hypot(tx, ty);
      if (s.target.protected && dist < 17) {
        s.state = 'flee';
        M.shift.slugsRepelled++;
        logEvent('slug_repelled', { plot: s.target.id });
        continue;
      }
      if (dist < 6) {
        s.target.state = 'nibbled';
        paintPlot(s.target);
        M.shift.nibbled++;
        logEvent('nibbled', { plot: s.target.id });
        toast('🥀 A slug nibbled a moonflower…');
        updateGoals();
        s.state = 'flee';
        continue;
      }
      const speed = 5.5 * dt;
      dx = (tx / dist) * speed;
      s.x += dx;
      s.y += (ty / dist) * speed;
    }
    place(s.node, s.x, s.y);
    // the snail emoji faces left; mirror it when it crawls right
    s.node.firstChild.style.transform = dx > 0 ? 'scaleX(-1)' : '';
  }
}

// --- main loop ---

let last = 0;

function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (S.mode !== 'night') return;
  if (!S.paused) update(dt);
  requestAnimationFrame(tick);
}

function update(dt) {
  S.t += dt;

  const hours = 18 + (S.t / CONFIG.shiftSeconds) * 12;
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60 / 10) * 10;
  setClock(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

  // dew forms on the glass
  S.dewTimer -= dt;
  if (S.dewTimer <= 0) {
    S.dewTimer = 3.5;
    if (S.dews.length < 4) spawnDew();
  }
  for (const d of [...S.dews]) {
    d.life -= dt;
    if (d.life <= 0) { d.node.remove(); S.dews.splice(S.dews.indexOf(d), 1); }
  }

  // moth: wander, or fly to its target
  const moth = S.moth;
  if (moth.target) {
    const tx = moth.target.x - moth.x;
    const ty = moth.target.y - moth.y;
    const dist = Math.hypot(tx, ty);
    const step = 55 * dt;
    if (dist <= step) {
      moth.x = moth.target.x;
      moth.y = moth.target.y;
      const done = moth.onArrive;
      if (moth.target.home) { moth.target = null; moth.phase = 0; } else moth.target = { ...moth.target, waiting: true };
      moth.onArrive = null;
      if (done) done();
    } else if (!moth.target.waiting) {
      moth.x += (tx / dist) * step;
      moth.y += (ty / dist) * step;
    }
  } else {
    moth.phase += dt;
    moth.x = 50 + 32 * Math.sin(moth.phase * 0.55);
    moth.y = 24 + 9 * Math.sin(moth.phase * 1.3);
  }
  place(moth.node, moth.x, moth.y);

  // slugs arrive mid-shift
  if (S.slugEvent === 'pending' && S.t >= CONFIG.slugStart) {
    S.slugEvent = 'active';
    S.slugTimer = 5;
    spawnSlug();
    spawnSlug();
    logEvent('slugs_arrive');
    toast('🐌 Slugs are sliding toward the moonflowers!', 3000);
  }
  if (S.slugEvent === 'active') {
    S.slugTimer -= dt;
    if (S.slugTimer <= 0) { S.slugTimer = 5; spawnSlug(); }
    if (S.t >= CONFIG.slugEnd) { S.slugEvent = 'done'; logEvent('slugs_leave'); }
  }
  updateSlugs(dt);

  if (S.t >= CONFIG.shiftSeconds) endShift(false);
}

// --- end shift button (tap twice to confirm) ---

let endArmed = null;
$('#btn-end').addEventListener('click', () => {
  if (S.mode !== 'night' || S.paused) return;
  const b = $('#btn-end');
  if (endArmed) {
    clearTimeout(endArmed);
    endArmed = null;
    endShift(true);
    return;
  }
  b.textContent = 'Tap again';
  b.classList.add('armed');
  endArmed = setTimeout(() => {
    endArmed = null;
    b.textContent = 'End shift';
    b.classList.remove('armed');
  }, 3000);
});

$('#btn-journal').addEventListener('click', () => {
  if (S.mode !== 'night' || S.paused) return;
  M.journal.reopens++;
  logEvent('journal_reopen');
  showJournal(false);
});

// ---------------------------------------------------------------------------
// 5. Handover at dawn
// ---------------------------------------------------------------------------

function endShift(early) {
  S.mode = 'handover';
  S.paused = true;
  M.shift.endedEarly = early;
  M.shift.lengthS = shiftSecs();
  logEvent('shift_end', { early });
  S.slugs.forEach((s) => s.node.remove());
  S.slugs = [];
  setSky('dawn');
  setClock('06:00');
  setPhase('Dawn: handover to Sol');
  ['#bar', '#goals', '#btn-journal'].forEach((s) => $(s).classList.add('hidden'));

  const bloomed = M.shift.bloomed;
  const gifts = [
    { id: 'fireflies', label: '🫙 Jar of fireflies, to glow on Sol\'s windowsill', ok: true },
    { id: 'petal', label: '💮 A moonflower petal', ok: bloomed > 0 },
    { id: 'dew', label: '💧 A vial of night dew', ok: S.inv.dew > 0 },
    { id: 'none', label: 'No gift this time', ok: true },
  ];
  const panel = showPanel(`
    <h2>🌅 Dawn: hand over to Sol</h2>
    <p>Sol will wake up to:</p>
    <ul class="list">
      <li>💮 ${bloomed} moonflower${bloomed === 1 ? '' : 's'} opened${M.shift.nibbled ? ` · 🥀 ${M.shift.nibbled} nibbled` : ''}</li>
      <li>🟤 ${S.inv.compost} compost · 💧 ${S.inv.dew} dew for the morning</li>
    </ul>
    <label class="field">Leave Sol a note (optional)<textarea id="note" rows="3" maxlength="240"></textarea></label>
    <p><b>Pack a gift Sol can't get by day:</b></p>
    ${gifts.map((g) => `<label class="choice ${g.ok ? '' : 'disabled'}"><input type="radio" name="gift" value="${g.id}" ${g.ok ? '' : 'disabled'} ${g.id === 'fireflies' ? 'checked' : ''}> ${g.label}</label>`).join('')}
    <button class="primary" id="handover">Hand over to Sol ☀️</button>`);
  panel.querySelector('#handover').onclick = () => {
    M.handover.note = panel.querySelector('#note').value.trim();
    M.handover.giftPacked = panel.querySelector('input[name=gift]:checked').value;
    logEvent('handover', { noteChars: M.handover.note.length, gift: M.handover.giftPacked });
    showRecall();
  };
}

// ---------------------------------------------------------------------------
// 6. Recall check + results (for the playtest)
// ---------------------------------------------------------------------------

const RECALL = [
  { text: 'Watered the moonflower buds', truth: true },
  { text: 'Fixed a crack in the glass roof', truth: false },
  { text: 'Planted a new sunflower', truth: true },
  { text: 'Raked leaves into the basket', truth: true },
  { text: 'Harvested the mushrooms', truth: false },
  { text: 'Spotted slug trails', truth: true },
  { text: 'Caught fireflies', truth: false },
  { text: 'Guided bees to the sunflowers', truth: true },
];

function showRecall() {
  S.mode = 'done';
  const panel = showPanel(`
    <h2>One last question</h2>
    <p>Without looking back: what did <b>Sol</b> do while you slept? Tick everything you remember.</p>
    ${RECALL.map((r, i) => `<label class="choice"><input type="checkbox" value="${i}"> ${r.text}</label>`).join('')}
    <button class="primary" id="done">See results</button>`);
  panel.querySelector('#done').onclick = () => {
    const picked = [...panel.querySelectorAll('input:checked')].map((c) => +c.value);
    M.recall.of = RECALL.filter((r) => r.truth).length;
    M.recall.hits = picked.filter((i) => RECALL[i].truth).length;
    M.recall.falseAlarms = picked.filter((i) => !RECALL[i].truth).length;
    M.recall.picked = picked.map((i) => RECALL[i].text);
    logEvent('recall', { hits: M.recall.hits, falseAlarms: M.recall.falseAlarms });
    showResults();
  };
}

function fmt(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function saveSession() {
  try {
    const all = JSON.parse(localStorage.getItem('tg_sessions') || '[]');
    all.push(M);
    localStorage.setItem('tg_sessions', JSON.stringify(all));
    return all;
  } catch (err) {
    return [M];
  }
}

function copyText(text, panel) {
  const fallback = () => {
    let ta = panel.querySelector('textarea.dump');
    if (!ta) { ta = el('textarea', 'dump'); panel.append(ta); }
    ta.value = text;
    ta.select();
    toast('Select all and copy the text below.');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Copied ✔'), fallback);
  } else {
    fallback();
  }
}

function showResults() {
  const all = saveSession();
  const r = M.recap;
  const g = M.gift;
  const sh = M.shift;
  const panel = showPanel(`
    <h2>Thanks for playing 🌙</h2>
    <p class="sub">Playtest summary${M.tester ? ` · ${M.tester}` : ''} · feel ${M.variant.feel} · recap ${M.variant.recap}</p>
    <ul class="list results">
      <li><b>Recap</b> ${r.seconds}s · ${r.skipped ? `skipped at step ${r.stepReached}/${r.steps}` : `watched all ${r.steps} steps`}</li>
      <li><b>Journal</b> read ${M.journal.firstReadSeconds}s · reopened ×${M.journal.reopens}</li>
      <li><b>Gift</b> ${g.openedWhere ? `opened in ${g.openedWhere}${g.openedWhere === 'inventory' ? ` at ${fmt(g.openedAtShiftS)}` : ''}` : 'never opened'} · ${g.uses ? `first used at ${fmt(g.firstUseShiftS)} (×${g.uses})` : 'never used'}</li>
      <li><b>Leaves</b> ${sh.leavesTakenS != null ? `taken at ${fmt(sh.leavesTakenS)}` : 'never taken'} · compost ${sh.compost}</li>
      <li><b>Flowers</b> opened ${sh.bloomed} · nibbled ${sh.nibbled} · slugs picked ${sh.slugsPicked} · repelled ${sh.slugsRepelled}</li>
      <li><b>First</b> ${sh.firstAction || '—'} at ${fmt(sh.firstActionS)} · dew ${sh.dew}</li>
      <li><b>Shift</b> ${fmt(sh.lengthS)}${sh.endedEarly ? ' (ended early)' : ''}</li>
      <li><b>Recall</b> ${M.recall.hits}/${M.recall.of} correct · ${M.recall.falseAlarms} false</li>
      <li><b>Note</b> ${M.handover.note ? `“${M.handover.note.replace(/</g, '&lt;')}”` : '—'} · gift: ${M.handover.giftPacked}</li>
    </ul>
    <button class="primary" id="copy">Copy this result</button>
    <button class="primary" id="copyall">Copy all sessions on this device (${all.length})</button>
    <button class="primary" id="again">Play again</button>`);
  panel.querySelector('#copy').onclick = () => copyText(JSON.stringify(M, null, 2), panel);
  panel.querySelector('#copyall').onclick = () => copyText(JSON.stringify(all, null, 2), panel);
  panel.querySelector('#again').onclick = () => location.reload();
}

// ---------------------------------------------------------------------------

buildScene();
showLogin();
