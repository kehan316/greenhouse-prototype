'use strict';
// Twilight Greenhouse — Night Shift prototype
// CSC 486B Assignment 3 · Kehan Wang
//
// Design question: after the "While You Slept" recap, can the Night Keeper tell
// what their partner did, and do they use what the partner left behind?
// The Day Keeper (Sol) is scripted and the time between shifts is simulated.
//
// URL options:  ?feel=off   -> "before" version of the gift-opening feel pass
//               ?recap=noskip | text   -> recap variants (default: animated tour + skippable)
//
// Art: Kenney "Isometric Miniature Farm" (CC0) for ground, beds, walls and props;
// emoji for plants and creatures. Engine: Phaser 3.

const params = new URLSearchParams(location.search);
const CONFIG = {
  feel: params.get('feel') !== 'off',
  recap: ['anim', 'noskip', 'text'].includes(params.get('recap')) ? params.get('recap') : 'anim',
  shiftSeconds: 180,
  slugStart: 50,
  slugEnd: 86,
};

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

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
  inv: { dew: 0, leaves: 0, compost: 0, fireflies: 0, gift: 'wrapped', eggshells: 0 },
  slugEvent: 'pending',   // pending | active | done
  slugTimer: 0,
  dewTimer: 2,
  recapSkipped: false,
  bubble: null,
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
  markers: { total: 0, visited: [] },
  gift: { openedWhere: null, openedAtShiftS: null, firstUseShiftS: null, uses: 0 },
  shift: {
    firstAction: null, firstActionS: null, leavesTakenS: null,
    leaves: 0, compost: 0, dew: 0, bloomed: 0, jasmine: 0, mushroomFeeds: 0,
    fireflies: 0, wormsSent: 0, nibbled: 0, slugsPicked: 0, slugsByFrog: 0, slugsRepelled: 0,
    endedEarly: false, lengthS: 0,
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
// HTML UI helpers
// ---------------------------------------------------------------------------

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

function showPanel(html) {
  closeBubble();
  $('#panel').innerHTML = html;
  $('#overlay').classList.remove('hidden');
  $('#panel').scrollTop = 0;
  return $('#panel');
}

function hidePanel() { $('#overlay').classList.add('hidden'); }

// ===========================================================================
// The greenhouse world (Phaser, isometric)
// ===========================================================================

const TW = 128;              // tile width on screen (Kenney tiles scaled to 128×256)
const TH = 64;               // tile height of the top diamond
const TILE_ORIGIN_Y = 0.8535; // centre of the top diamond inside the 128×256 image
const MAP = 8;
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const DEPTH_NIGHT = 50000;   // night tint sits above the world…
const DEPTH_GLOW = 60000;    // …glows, labels and markers sit above the tint

function iso(c, r) { return { x: ((c - r) * TW) / 2, y: ((c + r) * TH) / 2 }; }

let G = null;      // the Phaser scene, once created
const E = {};      // entities by id
const movers = { moths: [], worms: [], fireflies: [], slugs: [], dews: [] };

// Map layout. (c, r): c grows to the lower right, r to the lower left.
const PATH = (c, r) => r === 4 || c === 3;
const BEDS = [[1, 1], [2, 1], [5, 1], [6, 1], [5, 2], [6, 2], [1, 5], [2, 5]];

class GreenhouseScene extends Phaser.Scene {
  constructor() { super('greenhouse'); }

  preload() {
    const tiles = ['dirt_N', 'dirtFarmland_N', 'planks_N', 'planksOld_N', 'fenceLow_N', 'fenceLow_W',
      'woodWallWindowGlass_E', 'woodWallWindowGlass_S', 'woodWall_E', 'woodWall_S',
      'hayBales_N', 'sacksCrate_N', 'sack_N'];
    for (const k of tiles) this.load.image(k, `assets/kenney/${k}.png`);
  }

  create() {
    G = this;
    buildWorld(this);
    setupCamera();
    setupInput(this);
    this.scale.on('resize', () => fitCamera(false));
    showLogin();
  }

  update(time, delta) {
    tick(Math.min(0.1, delta / 1000));
  }
}

// ---------- building the world ----------

function tileImage(scene, key, c, r, depth) {
  const p = iso(c, r);
  return scene.add.image(p.x, p.y, key).setOrigin(0.5, TILE_ORIGIN_Y).setDepth(depth);
}

function emoji(scene, x, y, ch, size, depth) {
  return scene.add.text(x, y, ch, { fontSize: size + 'px', fontFamily: EMOJI_FONT, padding: { x: 4, y: 10 } })
    .setOrigin(0.5, 1).setDepth(depth).setResolution(2);
}

function label(scene, x, y, text) {
  return scene.add.text(x, y, text, {
    fontSize: '16px', fontFamily: 'system-ui, sans-serif', color: '#fff8e8',
    stroke: '#2a2030', strokeThickness: 4,
  }).setOrigin(0.5, 0).setDepth(DEPTH_GLOW + 1).setResolution(2);
}

function makeEnt(id, kind, c, r, ch, size, extra = {}) {
  const p = iso(c, r);
  const y = p.y + 10;
  const e = { id, kind, c, r, x: p.x, y, size, ...extra };
  e.shadow = G.add.ellipse(p.x, y - 2, size * 0.75, size * 0.26, 0x000000, 0.25).setDepth(y - 1);
  e.obj = emoji(G, p.x, y, ch, size, y);
  makeTappable(e.obj, e);
  if (extra.label) e.label = label(G, p.x, y + 4, extra.label);
  E[id] = e;
  return e;
}

function makeTappable(obj, e, pad = 12) {
  obj.setInteractive(new Phaser.Geom.Rectangle(-pad, -pad, obj.width + pad * 2, obj.height + pad * 2),
    Phaser.Geom.Rectangle.Contains);
  obj.ent = e;
}

function setEmoji(e, ch) {
  e.obj.setText(ch);
  makeTappable(e.obj, e);
}

function bump(obj) {
  G.tweens.add({ targets: obj, scale: { from: 0.4, to: 1 }, duration: 500, ease: 'Back.Out' });
}

function halo(x, y, radius, color, alpha) {
  const h = G.add.circle(x, y, radius, color, alpha).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_GLOW);
  G.tweens.add({ targets: h, alpha: alpha * 0.4, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  return h;
}

function buildWorld(scene) {
  // ground, beds and the plank path
  for (let c = 0; c < MAP; c++) {
    for (let r = 0; r < MAP; r++) {
      const bed = BEDS.some(([bc, br]) => bc === c && br === r);
      const key = bed ? 'dirtFarmland_N' : PATH(c, r) ? ((c + r) % 3 ? 'planks_N' : 'planksOld_N') : 'dirt_N';
      tileImage(scene, key, c, r, -10000 + iso(c, r).y);
    }
  }
  // glass walls along the back, low fences along the front (gap at the door)
  for (let i = 0; i < MAP; i++) {
    const glass = i % 3 !== 2;
    tileImage(scene, glass ? 'woodWallWindowGlass_E' : 'woodWall_E', 0, i, iso(0, i).y - 40);
    tileImage(scene, glass ? 'woodWallWindowGlass_S' : 'woodWall_S', i, 0, iso(i, 0).y - 40);
    if (i !== 3) tileImage(scene, 'fenceLow_N', i, MAP - 1, iso(i, MAP - 1).y + 40);
    tileImage(scene, 'fenceLow_W', MAP - 1, i, iso(MAP - 1, i).y + 40);
  }
  // props
  tileImage(scene, 'hayBales_N', 7, 0, iso(7, 0).y + 5);
  tileImage(scene, 'sacksCrate_N', 0, 7, iso(0, 7).y + 5);
  tileImage(scene, 'sack_N', 1, 7, iso(1, 7).y + 5);

  // pond (2×2 tiles), drawn
  const pond = scene.add.graphics().setDepth(-5000);
  const pts = [iso(4.6, 4.6), iso(6.4, 4.6), iso(6.4, 6.4), iso(4.6, 6.4)];
  pond.fillStyle(0x6b4f35, 1).fillPoints(pts.map((p) => ({ x: p.x, y: p.y + 4 })), true);
  pond.fillStyle(0x3d8fb8, 1).fillPoints(pts, true);
  pond.fillStyle(0x58aed3, 1).fillPoints([iso(4.9, 4.9), iso(6.1, 4.9), iso(6.1, 6.1), iso(4.9, 6.1)], true);
  const lily = iso(5.8, 5.2);
  scene.add.ellipse(lily.x, lily.y, 34, 14, 0x4f9a45, 1).setDepth(-4999);

  // plants
  makeEnt('sunA', 'sunflower', 1, 1, '🌿', 54, { state: 'bud' });
  makeEnt('sunB', 'sunflower', 2, 1, '', 54, { state: 'empty' });
  for (const [id, c, r] of [['moonA', 5, 1], ['moonB', 6, 1], ['moonC', 6, 2]]) {
    makeEnt(id, 'moon', c, r, '🌱', 50, { state: 'dry', protected: false });
  }
  makeEnt('jasA', 'jasmine', 1, 5, '🌿', 50, { state: 'thirsty', protected: false });
  makeEnt('jasB', 'jasmine', 2, 5, '🌿', 50, { state: 'thirsty', protected: false });
  makeEnt('mush', 'mushroom', 7, 5, '🍄', 34, { level: 0, label: 'mushrooms' });

  // facilities
  makeEnt('dewc', 'dewc', 0, 1, '🫙', 36, { amount: 1, timer: 12, label: 'dew collector' });
  makeEnt('basket', 'basket', 0, 3, '🧺', 40, { leaves: 0, label: 'leaf basket' });
  const bin = tileImage(scene, 'sacksCrate_N', 7, 3, iso(7, 3).y + 10);
  E.bin = { id: 'bin', kind: 'bin', c: 7, r: 3, x: bin.x, y: bin.y, obj: bin, queue: 0, timer: 6, worms: 0 };
  // the crate only fills a small part of the 128×256 tile image
  bin.setInteractive(new Phaser.Geom.Rectangle(26, 186, 66, 56), Phaser.Geom.Rectangle.Contains);
  bin.ent = E.bin;
  E.bin.bubbleY = bin.y - 30;
  E.bin.label = label(scene, bin.x, bin.y + 8, 'compost bin');
  makeEnt('mailbox', 'mailbox', 3.6, 7.2, '📮', 38, { label: 'mailbox' });
  makeEnt('gift', 'gift', 3, 3, '🎁', 40);
  E.gift.obj.setVisible(false);
  E.gift.shadow.setVisible(false);

  // creatures that are around all day
  const frogHome = iso(5.5, 5.6);
  E.frog = { id: 'frog', kind: 'frog', gc: 5.5, gr: 5.6, home: { gc: 5.5, gr: 5.6 }, state: 'idle', target: null };
  E.frog.obj = emoji(scene, frogHome.x, frogHome.y, '🐸', 30, frogHome.y + 20);
  makeTappable(E.frog.obj, E.frog);
  for (const [gc, gr] of [[2.2, 2.4], [4.5, 6.6]]) {
    const w = { kind: 'worm', gc, gr, dest: null, state: 'roam' };
    w.obj = emoji(scene, 0, 0, '🪱', 22, 0);
    makeTappable(w.obj, w, 16);
    movers.worms.push(w);
    placeMover(w);
  }

  // day / night tint over the whole view
  const big = 8000;
  G.warm = scene.add.rectangle(0, 0, big, big, 0xff9a5a, 1).setScrollFactor(0).setDepth(DEPTH_NIGHT)
    .setBlendMode(Phaser.BlendModes.MULTIPLY).setAlpha(0);
  G.night = scene.add.rectangle(0, 0, big, big, 0x2a3a8c, 1).setScrollFactor(0).setDepth(DEPTH_NIGHT + 1)
    .setBlendMode(Phaser.BlendModes.MULTIPLY).setAlpha(0);
  setSky('dusk', 0);
}

const SKIES = {
  dawn: { bg: '#f6c9a2', warm: 0.18, night: 0 },
  day: { bg: '#bfe3f5', warm: 0, night: 0 },
  dusk: { bg: '#e7956b', warm: 0.32, night: 0.15 },
  night: { bg: '#141c45', warm: 0, night: 0.5 },
};

function setSky(name, ms = 1200) {
  const s = SKIES[name];
  G.cameras.main.setBackgroundColor(s.bg);
  G.tweens.add({ targets: G.warm, alpha: s.warm, duration: ms });
  G.tweens.add({ targets: G.night, alpha: s.night, duration: ms });
}

function placeMover(m, lift = 0) {
  const p = iso(m.gc, m.gr);
  m.obj.setPosition(p.x, p.y + 8 - lift);
  m.obj.setDepth(p.y + 8);
}

// ---------- camera: drag to pan, pinch / wheel to zoom ----------

// the camera centre is kept inside this box instead of using hard camera bounds,
// so a portrait phone can still zoom out to see the whole greenhouse
const VIEW = { minX: -520, maxX: 520, minY: -120, maxY: 540, fitW: 1150, fitH: 820 };

function setupCamera() {
  fitCamera(true);
}

function minZoom() {
  const cam = G.cameras.main;
  return Math.min(cam.width / VIEW.fitW, cam.height / VIEW.fitH);
}

function clampCamera() {
  const cam = G.cameras.main;
  const cx = Phaser.Math.Clamp(cam.scrollX + cam.width / 2, VIEW.minX, VIEW.maxX);
  const cy = Phaser.Math.Clamp(cam.scrollY + cam.height / 2, VIEW.minY, VIEW.maxY);
  cam.centerOn(cx, cy);
}

function fitCamera(recenter) {
  const cam = G.cameras.main;
  if (recenter || S.mode === 'login') {
    cam.setZoom(Phaser.Math.Clamp(cam.width / 760, minZoom(), 1.1));
    cam.centerOn(0, 230);
  }
  G.warm.setPosition(cam.width / 2, cam.height / 2);
  G.night.setPosition(cam.width / 2, cam.height / 2);
}

// close enough that tiles are easy to tap on a phone; drag to see the rest
function playZoom() {
  const cam = G.cameras.main;
  return Phaser.Math.Clamp(Math.min(cam.width / 480, cam.height / 520), minZoom(), 1.1);
}

function zoomBy(f) {
  const cam = G.cameras.main;
  cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, minZoom(), 1.6));
}

function setupInput(scene) {
  scene.input.addPointer(1);
  let downAt = null;
  let dragged = false;
  let pinch = null;

  scene.input.on('pointerdown', (p) => {
    downAt = { x: p.x, y: p.y };
    dragged = false;
  });

  scene.input.on('pointermove', (p) => {
    const p1 = scene.input.pointer1;
    const p2 = scene.input.pointer2;
    if (p1.isDown && p2.isDown) {
      const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
      if (pinch) zoomBy(d / pinch);
      pinch = d;
      dragged = true;
      return;
    }
    pinch = null;
    if (!p.isDown || !downAt || S.mode === 'recap') return;
    if (!dragged && Phaser.Math.Distance.Between(p.x, p.y, downAt.x, downAt.y) > 10) dragged = true;
    if (dragged) {
      const cam = scene.cameras.main;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      clampCamera();
    }
  });

  scene.input.on('pointerup', (p) => {
    pinch = null;
    if (dragged || !downAt) return;
    downAt = null;
    const hits = scene.input.hitTestPointer(p).filter((o) => o.ent && o.visible);
    hits.sort((a, b) => b.depth - a.depth);
    onTap(hits.length ? hits[0].ent : null);
  });

  scene.input.on('wheel', (p, objs, dx, dy) => zoomBy(dy > 0 ? 0.9 : 1.1));
}

// ---------- context bubble (QQ-farm style) ----------

function worldToApp(wx, wy) {
  const cam = G.cameras.main;
  const cr = G.game.canvas.getBoundingClientRect();
  const ar = $('#app').getBoundingClientRect();
  return {
    x: (wx - cam.worldView.x) * cam.zoom + cr.left - ar.left,
    y: (wy - cam.worldView.y) * cam.zoom + cr.top - ar.top,
  };
}

function openBubble(e) {
  const def = bubbleFor(e);
  if (!def) return closeBubble();
  const b = $('#bubble');
  b.innerHTML = `<b>${def.title}</b>${def.sub ? `<div class="sub">${def.sub}</div>` : ''}`;
  (def.actions || []).forEach((a) => {
    const btn = el('button', '', a.label);
    btn.disabled = !!a.disabled;
    btn.onclick = (ev) => {
      ev.stopPropagation();
      closeBubble();
      a.fn();
    };
    b.append(btn);
  });
  b.classList.remove('hidden');
  S.bubble = e;
  positionBubble();
}

function closeBubble() {
  $('#bubble').classList.add('hidden');
  S.bubble = null;
}

function positionBubble() {
  const e = S.bubble;
  if (!e || !e.obj.active) return;
  const top = e.bubbleY ?? e.obj.y - (e.obj.displayHeight || 40) * e.obj.originY + 8;
  const p = worldToApp(e.obj.x, top);
  const b = $('#bubble');
  const half = b.offsetWidth / 2;
  const appW = $('#app').clientWidth;
  b.style.left = Phaser.Math.Clamp(p.x, half + 6, appW - half - 6) + 'px';
  b.style.top = Math.max(p.y, b.offsetHeight + 16) + 'px';
}

// ---------- "Sol was here" markers ----------

const MARKED = ['moonA', 'sunB', 'basket', 'jasA', 'gift'];

function addMarkers() {
  for (const id of MARKED) {
    const e = E[id];
    if (!e || e.marker) continue;
    const top = e.y - e.size - 14;
    e.marker = G.add.text(e.x + 14, top, '☀️', { fontSize: '20px', fontFamily: EMOJI_FONT, padding: { x: 2, y: 6 } })
      .setOrigin(0.5, 1).setDepth(DEPTH_GLOW + 2).setResolution(2);
    makeTappable(e.marker, e, 10);
    G.tweens.add({ targets: e.marker, y: top - 8, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }
  M.markers.total = MARKED.length;
}

function visitMarker(e) {
  if (!e.marker) return;
  e.marker.destroy();
  e.marker = null;
  M.markers.visited.push({ id: e.id, t: S.mode === 'night' ? shiftSecs() : 0 });
  logEvent('marker_visited', { id: e.id });
}

// ===========================================================================
// 1. Login
// ===========================================================================

function showLogin() {
  setClock('18:00');
  setPhase('Twilight Greenhouse');
  const panel = showPanel(`
    <h1>Twilight Greenhouse</h1>
    <p class="sub">Night Keeper prototype · CSC 486B Assignment 3 · Kehan Wang</p>
    <div class="notif"><b>☀️ Sol</b> handed over the greenhouse<br><span>“Your turn, Night Keeper! 🌙”</span><small>18:00</small></div>
    <p>You and Sol share a greenhouse but live on opposite sides of the world. Sol tends it by day while you sleep; you tend it by night while Sol sleeps.</p>
    <p class="sub">Drag to look around · pinch or scroll to zoom · tap anything to interact.</p>
    <label class="field">Tester ID (optional)<input id="tester" placeholder="e.g. T1" autocomplete="off"></label>
    <button class="primary" id="go">Open the greenhouse 🌙</button>
    <details>
      <summary>Tester settings</summary>
      <div><b>Feel pass</b>
        <label><input type="radio" name="feel" value="on"> On (after)</label>
        <label><input type="radio" name="feel" value="off"> Off (before)</label>
      </div>
      <div><b>Recap</b>
        <label><input type="radio" name="recap" value="anim"> Animated tour, skippable</label>
        <label><input type="radio" name="recap" value="noskip"> Animated tour, no skip</label>
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

// ===========================================================================
// 2. "While You Slept" — a ghost of Sol walks the greenhouse and replays the day
// ===========================================================================

const TOUR = [
  {
    time: '06:40', sky: 'dawn', at: [3, 6.4], icon: '👋',
    text: 'Sol logged in ☀️ and stepped into the greenhouse',
    act() {},
  },
  {
    time: '07:15', sky: 'day', at: [5.2, 2.6], icon: '💧',
    text: 'Sol watered your moonflowers with the dew you collected last night',
    act() { ['moonA', 'moonB', 'moonC'].forEach((id) => splash(E[id])); },
  },
  {
    time: '09:00', at: [2.4, 2.1], icon: '🌱',
    text: 'Sol planted a new sunflower',
    act() { E.sunB.state = 'sprout'; setEmoji(E.sunB, '🌱'); bump(E.sunB.obj); },
  },
  {
    time: '11:30', at: [1.6, 2.2], icon: '🐝',
    text: 'Sol guided the bees to pollinate the sunflowers',
    act() {
      beeFlight();
      G.time.delayedCall(1200, () => { E.sunA.state = 'bloom'; setEmoji(E.sunA, '🌻'); bump(E.sunA.obj); });
    },
  },
  {
    time: '14:00', at: [4, 1.8], icon: '✨',
    text: 'The sunflowers stored daylight, so the moonflowers can open tonight',
    act() { sparkleLine(E.sunA, E.moonA); ['moonA', 'moonB', 'moonC'].forEach((id) => setMoonReady(E[id])); },
  },
  {
    time: '15:30', at: [0.9, 3.4], icon: '🍂',
    text: 'Sol raked the fallen leaves into the basket for you',
    act() { fillBasket(); },
  },
  {
    time: '17:20', sky: 'dusk', at: [2.2, 4.3], icon: '🐌',
    text: 'Sol spotted slug trails near the flowers',
    act() { addTrails(); },
  },
  {
    time: '17:50', at: [3, 3.7], icon: '🎁',
    text: 'Sol left you a gift and a note in the mailbox',
    act() { showGift(); },
  },
];

// --- tour helpers (each can also run instantly when the recap is skipped) ---

function splash(e) {
  const d = emoji(G, e.x, e.y - 30, '💧', 20, DEPTH_GLOW);
  G.tweens.add({ targets: d, y: e.y - 6, alpha: 0, duration: 900, onComplete: () => d.destroy() });
}

function beeFlight() {
  const a = iso(-0.5, 2);
  const b = emoji(G, a.x, a.y - 40, '🐝', 26, DEPTH_GLOW);
  const pts = [iso(1, 1), iso(2, 1), iso(2, -1)];
  G.tweens.chain({
    targets: b,
    tweens: pts.map((p) => ({ x: p.x, y: p.y - 40, duration: 800, ease: 'Sine.InOut' })),
    onComplete: () => b.destroy(),
  });
}

function sparkleLine(from, to) {
  for (let i = 0; i < 6; i++) {
    const s = emoji(G, from.x, from.y - 30, '✨', 18, DEPTH_GLOW);
    G.tweens.add({ targets: s, x: to.x, y: to.y - 30, alpha: 0.2, delay: i * 120, duration: 900, ease: 'Sine.InOut', onComplete: () => s.destroy() });
  }
}

function setMoonReady(e) {
  if (e.state !== 'dry') return;
  e.state = 'ready';
  setEmoji(e, '🌷');
  bump(e.obj);
  e.halo = halo(e.x, e.y - 20, 18, 0xfff3a0, 0.2);
}

function fillBasket() {
  if (E.basket.leaves) return;
  E.basket.leaves = 3;
  E.basket.pile = emoji(G, E.basket.x + 12, E.basket.y - 22, '🍂', 22, E.basket.y + 1);
  makeTappable(E.basket.pile, E.basket);
  bump(E.basket.pile);
  E.basket.label.setText("Sol's leaves ×3");
}

function addTrails() {
  if (G.trails) return;
  G.trails = [];
  for (const [c, r] of [[1.6, 5.6], [2.6, 5.4], [5.6, 2.6], [6.6, 2.3]]) {
    const p = iso(c, r);
    G.trails.push(G.add.text(p.x, p.y, '〰️', { fontSize: '18px', fontFamily: EMOJI_FONT }).setOrigin(0.5).setDepth(p.y).setAlpha(0.8));
  }
}

function showGift() {
  if (S.inv.gift !== 'wrapped' || E.gift.obj.visible) return;
  E.gift.obj.setVisible(true);
  E.gift.shadow.setVisible(true);
  bump(E.gift.obj);
}

function applyTourEndState() {
  ['moonA', 'moonB', 'moonC'].forEach((id) => setMoonReady(E[id]));
  if (E.sunB.state === 'empty') { E.sunB.state = 'sprout'; setEmoji(E.sunB, '🌱'); }
  if (E.sunA.state !== 'bloom') { E.sunA.state = 'bloom'; setEmoji(E.sunA, '🌻'); }
  fillBasket();
  addTrails();
  showGift();
}

// --- the ghost ---

function makeGhost() {
  const g = { gc: 3, gr: 7.6 };
  g.obj = emoji(G, 0, 0, '🧑‍🌾', 54, DEPTH_GLOW).setAlpha(0);
  g.icon = G.add.text(0, 0, '', { fontSize: '22px', fontFamily: EMOJI_FONT, backgroundColor: '#fffaf0', padding: { x: 6, y: 6 } })
    .setOrigin(0.5, 1).setDepth(DEPTH_GLOW + 3).setResolution(2).setVisible(false);
  G.tweens.add({ targets: g.obj, alpha: 0.8, duration: 400 });
  placeGhost(g);
  return g;
}

function placeGhost(g) {
  const p = iso(g.gc, g.gr);
  g.obj.setPosition(p.x, p.y + 6);
  g.icon.setPosition(p.x, p.y - 58);
}

function walkGhost(g, c, r) {
  return new Promise((resolve) => {
    const dist = Math.hypot(c - g.gc, r - g.gr);
    g.walking = G.tweens.add({
      targets: g, gc: c, gr: r, duration: Math.max(300, dist * 330), ease: 'Sine.InOut',
      onUpdate: () => placeGhost(g),
      onComplete: resolve,
      onStop: resolve,
    });
  });
}

async function waitOrSkip(ms) {
  const until = performance.now() + ms;
  while (performance.now() < until && !S.recapSkipped) await sleep(50);
}

async function runRecap() {
  S.mode = 'recap';
  setPhase("While you slept… (Sol's day)");
  M.recap.steps = TOUR.length;
  const started = performance.now();
  const finish = () => {
    M.recap.seconds = +((performance.now() - started) / 1000).toFixed(1);
    logEvent('recap_done', { ...M.recap });
    $('#caption').classList.add('hidden');
    G.scale.refresh();
    addMarkers();
    showJournal(true);
  };

  if (CONFIG.recap === 'text') {
    applyTourEndState();
    setSky('dusk', 0);
    M.recap.stepReached = TOUR.length;
    const items = TOUR.map((s) => `<li><b>${s.time}</b> ${s.text}</li>`).join('');
    const panel = showPanel(`
      <h2>While you slept… ☀️</h2>
      <p class="sub">Sol's day in the greenhouse</p>
      <ul class="list">${items}</ul>
      <button class="primary" id="next">Read Sol's journal 📖</button>`);
    panel.querySelector('#next').onclick = () => { hidePanel(); finish(); };
    return;
  }

  const cap = $('#caption');
  cap.classList.remove('hidden');
  cap.innerHTML = `
    <div class="head">While you slept…</div>
    <div class="row"><div class="text"></div>
      ${CONFIG.recap === 'anim' ? '<button class="ghost" id="skip">Skip ⏭</button>' : ''}</div>
    <div class="progress"><div></div></div>`;
  G.scale.refresh();
  const textEl = cap.querySelector('.text');
  const bar = cap.querySelector('.progress div');
  const skip = cap.querySelector('#skip');

  const cam = G.cameras.main;
  cam.zoomTo(Math.max(minZoom(), Math.min(1, cam.width / 520)), 600);
  const ghost = makeGhost();
  cam.startFollow(ghost.obj, false, 0.08, 0.08);

  if (skip) {
    skip.onclick = () => {
      S.recapSkipped = true;
      M.recap.skipped = true;
      if (ghost.walking) ghost.walking.stop();
      logEvent('recap_skip', { atStep: M.recap.stepReached });
    };
  }

  for (let i = 0; i < TOUR.length && !S.recapSkipped; i++) {
    const step = TOUR[i];
    M.recap.stepReached = i + 1;
    setClock(step.time);
    if (step.sky) setSky(step.sky);
    textEl.textContent = step.text;
    bar.style.width = ((i + 1) / TOUR.length) * 100 + '%';
    ghost.icon.setVisible(false);
    await walkGhost(ghost, step.at[0], step.at[1]);
    if (S.recapSkipped) break;
    ghost.icon.setText(step.icon).setVisible(true);
    step.act();
    await waitOrSkip(1700);
  }

  applyTourEndState();
  ghost.icon.setVisible(false);
  if (!S.recapSkipped) await walkGhost(ghost, 3.6, 7.6);
  G.tweens.add({ targets: ghost.obj, alpha: 0, duration: 500, onComplete: () => { ghost.obj.destroy(); ghost.icon.destroy(); } });
  cam.stopFollow();
  setClock('18:00');
  setSky('dusk');
  bar.style.width = '100%';
  cap.querySelector('.head').textContent = '18:00 · Handover';
  textEl.textContent = 'Sol handed the greenhouse over to you. Good evening, Night Keeper 🌙';
  if (skip) skip.remove();
  const next = el('button', 'small-btn', "Read Sol's journal 📖");
  cap.querySelector('.row').append(next);
  next.onclick = finish;
}

// ===========================================================================
// 3. Journal + gift
// ===========================================================================

const JOURNAL_HTML = `
  <div class="journal">
    <p>Good morning! (well… good evening for you 🌙)</p>
    <p>Thank you for the dew last night, the moonflowers drank all of it. The sunflowers had a sunny day, so your moonflowers should be ready to open tonight.</p>
    <p>I raked the fallen leaves into the basket for your compost 🍂</p>
    <p>I saw slug trails near the flowers… so I left something that might help. Sleep well when you're done!</p>
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
    hidePanel();
    if (first) {
      M.journal.firstReadSeconds = +((performance.now() - opened) / 1000).toFixed(1);
      logEvent('journal_closed', { seconds: M.journal.firstReadSeconds, gift: S.inv.gift });
      startNight();
    } else {
      S.paused = false;
    }
  };
}

function showGiftPanel(where) {
  S.paused = true;
  const panel = showPanel(`
    <h2>🎁 Sol's gift</h2>
    ${giftZoneHtml()}
    <button class="primary" id="close">Back to the greenhouse</button>`);
  wireGiftBox(panel, where);
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
  E.gift.obj.setVisible(false);
  E.gift.shadow.setVisible(false);
  if (E.gift.marker) visitMarker(E.gift);
  if (S.mode === 'night') renderInventory();
}

// ===========================================================================
// 4. Night shift
// ===========================================================================

function startNight() {
  S.mode = 'night';
  S.t = 0;
  S.paused = false;
  setSky('night', 1500);
  setPhase('Your night shift');
  const cam = G.cameras.main;
  cam.pan(0, 230, 800, 'Sine.easeInOut');
  cam.zoomTo(playZoom(), 800);
  E.sunA.obj.setAlpha(0.85);
  // night creatures arrive
  for (let i = 0; i < 2; i++) {
    const m = { kind: 'moth', gc: 3.5 + i, gr: 2.5, phase: i * 2, target: null, home: { gc: 3.5 + i, gr: 2.5 } };
    m.obj = emoji(G, 0, 0, '🦋', 26, 0);
    makeTappable(m.obj, m, 16);
    movers.moths.push(m);
  }
  for (let i = 0; i < 3; i++) spawnFirefly(rand(4.6, 6.4), rand(4.6, 6.4));
  ['#bar', '#goals', '#btn-journal', '#btn-end'].forEach((s) => $(s).classList.remove('hidden'));
  G.scale.refresh();
  renderInventory();
  updateGoals();
  logEvent('shift_start');
}

function updateGoals() {
  $('#goals').textContent =
    `🌙 moonflowers ${M.shift.bloomed}/3 · 🌼 jasmine ${M.shift.jasmine}/2 · 🍄 lv ${E.mush.level}`;
}

function renderInventory() {
  const inv = $('#inventory');
  inv.innerHTML = '';
  const slot = (key, ch, count, name, extra = '') => {
    const b = el('button', `slot ${extra}`, `${ch}${count !== '' ? ' ' + count : ''}<small>${name}</small>`);
    b.dataset.slot = key;
    inv.append(b);
  };
  slot('dew', '💧', S.inv.dew, 'dew');
  slot('leaves', '🍂', S.inv.leaves, 'leaves');
  slot('compost', '🟤', S.inv.compost, 'compost');
  slot('fireflies', '✨', S.inv.fireflies, 'fireflies');
  if (S.inv.gift === 'opened') slot('eggshells', '🥚', S.inv.eggshells, 'eggshells');
  else slot('gift', '🎁', '', "Sol's gift", 'gift');
}

$('#inventory').addEventListener('click', (e) => {
  const b = e.target.closest('.slot');
  if (!b || S.mode !== 'night' || S.paused) return;
  closeBubble();
  const hints = {
    dew: 'Dew waters the night jasmine. Any left over goes to Sol in the morning 💧',
    leaves: 'The compost bin turns leaves into compost 🍂',
    compost: 'Compost feeds the mushrooms 🍄',
    fireflies: 'A jar of fireflies, a gift Sol can never catch by day ✨',
    eggshells: 'Tap a flower to sprinkle an eggshell ring around it 🥚',
  };
  if (b.dataset.slot === 'gift') {
    logEvent('gift_slot_tap');
    showGiftPanel('inventory');
  } else {
    toast(hints[b.dataset.slot]);
  }
});

// ---------- tapping things in the greenhouse ----------

function onTap(e) {
  if (S.mode !== 'night' || S.paused || !e) { closeBubble(); return; }
  if (e.marker) visitMarker(e);
  if (e.kind === 'dew') return collectDew(e);
  if (e.kind === 'firefly') return catchFirefly(e);
  if (e.kind === 'gift') { logEvent('gift_world_tap'); return showGiftPanel('greenhouse'); }
  if (e.kind === 'mailbox') { M.journal.reopens++; logEvent('journal_reopen', { from: 'mailbox' }); return showJournal(false); }
  if (S.bubble === e) return closeBubble();
  openBubble(e);
}

function eggshellAction(e) {
  if (S.inv.gift !== 'opened' || S.inv.eggshells <= 0 || e.protected || e.state === 'nibbled') return [];
  return [{ label: `Eggshell ring 🥚 (${S.inv.eggshells} left)`, fn: () => protect(e) }];
}

function bubbleFor(e) {
  const idleMoth = movers.moths.find((m) => !m.target);
  const idleFrog = E.frog.state === 'idle';
  switch (e.kind) {
    case 'sunflower':
      return {
        title: "Sunflower (Sol's)",
        sub: e.state === 'sprout' ? 'Sol planted this today. Asleep until morning 💤' : 'Asleep until morning 💤',
      };
    case 'moon': {
      const subs = {
        ready: 'Full of stored daylight. Ready to open, needs a moth to pollinate it.',
        bloom: 'In full bloom 🌙',
        nibbled: 'Slugs nibbled this one 🥀',
        dry: 'A moonflower bud.',
      };
      const actions = [];
      if (e.state === 'ready') {
        actions.push({ label: idleMoth ? 'Guide a moth here 🦋' : 'Moths are busy…', disabled: !idleMoth, fn: () => guideMoth(e) });
      }
      return { title: 'Moonflower' + (e.protected ? ' 🥚' : ''), sub: subs[e.state], actions: actions.concat(eggshellAction(e)) };
    }
    case 'jasmine': {
      const actions = [];
      if (e.state === 'thirsty') {
        actions.push({ label: S.inv.dew > 0 ? `Water with dew 💧 (${S.inv.dew})` : 'No dew yet', disabled: S.inv.dew <= 0, fn: () => waterJasmine(e) });
      }
      const subs = { thirsty: 'Night jasmine. Thirsty, it opens with a drop of dew.', bloom: 'Blooming, and fireflies love it ✨', nibbled: 'Slugs nibbled this one 🥀' };
      return { title: 'Night jasmine' + (e.protected ? ' 🥚' : ''), sub: subs[e.state], actions: actions.concat(eggshellAction(e)) };
    }
    case 'mushroom':
      return {
        title: `Glow mushrooms (lv ${e.level})`,
        sub: e.level >= 3 ? 'Glowing as bright as they can 🍄' : 'Compost makes them grow and glow.',
        actions: e.level < 3 ? [{ label: S.inv.compost > 0 ? `Feed compost 🟤 (${S.inv.compost})` : 'No compost yet', disabled: S.inv.compost <= 0, fn: () => feedMushrooms() }] : [],
      };
    case 'dewc':
      return {
        title: 'Dew collector',
        sub: `Fills up slowly through the night. ${e.amount} drop${e.amount === 1 ? '' : 's'} inside.`,
        actions: [{ label: `Collect dew 💧 (${e.amount})`, disabled: e.amount <= 0, fn: () => collectFromCollector() }],
      };
    case 'basket':
      return {
        title: 'Leaf basket',
        sub: e.leaves > 0 ? `Sol raked ${e.leaves} leaves in here for you.` : 'Empty.',
        actions: e.leaves > 0 ? [{ label: `Take Sol's leaves 🍂 (${e.leaves})`, fn: () => takeLeaves() }] : [],
      };
    case 'bin':
      return {
        title: 'Compost bin',
        sub: `${e.queue ? `Composting ${e.queue} leaf${e.queue > 1 ? 's' : ''}… ` : 'Turns leaves into compost. '}Worms inside: ${e.worms} (they speed it up).`,
        actions: [{ label: S.inv.leaves > 0 ? `Add leaves 🍂 (${S.inv.leaves})` : 'No leaves to add', disabled: S.inv.leaves <= 0, fn: () => addLeaves() }],
      };
    case 'worm':
      return e.state === 'roam'
        ? { title: 'Earthworm 🪱', sub: 'Worms make compost faster.', actions: [{ label: 'Send to the compost bin', fn: () => sendWorm(e) }] }
        : { title: 'Earthworm 🪱', sub: 'On its way to the compost bin.' };
    case 'moth':
      return { title: 'Moth 🦋', sub: 'Night pollinator. Tap a moonflower that is ready to guide one there.' };
    case 'frog': {
      const slugs = movers.slugs.length;
      return {
        title: 'Pond frog 🐸',
        sub: slugs ? 'Frogs love slugs.' : 'Resting by the pond.',
        actions: slugs ? [{ label: idleFrog ? 'Send after the slugs' : 'Busy hunting…', disabled: !idleFrog, fn: () => sendFrog(null) }] : [],
      };
    }
    case 'slug':
      return {
        title: 'Slug 🐌',
        sub: 'Heading for the flowers!',
        actions: [
          { label: 'Pick it off ✋', fn: () => pickSlug(e) },
          { label: idleFrog ? 'Call the frog 🐸' : 'Frog is busy…', disabled: !idleFrog, fn: () => sendFrog(e) },
        ],
      };
    default:
      return null;
  }
}

// ---------- actions ----------

function collectDew(d) {
  const { x, y } = d.obj;
  removeMover(movers.dews, d);
  gainDew(1, x, y);
}

function gainDew(n, x, y) {
  S.inv.dew += n;
  M.shift.dew += n;
  firstAction('collect_dew');
  floatText(x, y, `+${n} 💧`);
  renderInventory();
}

function collectFromCollector() {
  const c = E.dewc;
  if (c.amount <= 0) return;
  const n = c.amount;
  c.amount = 0;
  gainDew(n, c.x, c.y - 40);
  logEvent('dew_collector', { n });
}

function floatText(x, y, text) {
  const t = G.add.text(x, y - 20, text, { fontSize: '16px', fontFamily: EMOJI_FONT, color: '#fffbe0', stroke: '#2a2030', strokeThickness: 4 })
    .setOrigin(0.5).setDepth(DEPTH_GLOW + 5).setResolution(2);
  G.tweens.add({ targets: t, y: y - 60, alpha: 0, duration: 1000, onComplete: () => t.destroy() });
}

function takeLeaves() {
  const b = E.basket;
  const n = b.leaves;
  if (!n) return;
  b.leaves = 0;
  S.inv.leaves += n;
  M.shift.leaves += n;
  M.shift.leavesTakenS = shiftSecs();
  if (b.pile) { b.pile.destroy(); b.pile = null; }
  b.label.setText('leaf basket');
  firstAction('take_leaves');
  logEvent('leaves_taken', { n });
  floatText(b.x, b.y - 30, `+${n} 🍂`);
  renderInventory();
}

function addLeaves() {
  if (S.inv.leaves <= 0) return;
  E.bin.queue += S.inv.leaves;
  logEvent('leaves_to_bin', { n: S.inv.leaves });
  S.inv.leaves = 0;
  firstAction('compost');
  floatText(E.bin.x, E.bin.y - 50, '🍂 → 🟤');
  renderInventory();
}

function feedMushrooms() {
  const m = E.mush;
  if (S.inv.compost <= 0 || m.level >= 3) return;
  S.inv.compost--;
  m.level++;
  M.shift.mushroomFeeds++;
  firstAction('feed_mushrooms');
  logEvent('mushrooms_fed', { level: m.level });
  m.obj.setFontSize(34 + m.level * 8);
  makeTappable(m.obj, m);
  bump(m.obj);
  if (!m.halo) m.halo = halo(m.x, m.y - 16, 30, 0x6ff0e0, 0.2);
  m.halo.setRadius(28 + m.level * 10);
  renderInventory();
  updateGoals();
}

function waterJasmine(e) {
  if (S.inv.dew <= 0 || e.state !== 'thirsty') return;
  S.inv.dew--;
  e.state = 'bloom';
  setEmoji(e, '🌼');
  bump(e.obj);
  e.halo = halo(e.x, e.y - 18, 22, 0xfff6c0, 0.3);
  splash(e);
  M.shift.jasmine++;
  firstAction('water_jasmine');
  logEvent('jasmine_bloom', { id: e.id });
  for (let i = 0; i < 2; i++) spawnFirefly(e.c + rand(-0.6, 0.6), e.r + rand(-0.6, 0.6));
  renderInventory();
  updateGoals();
}

function protect(e) {
  if (S.inv.eggshells <= 0 || e.protected) return;
  e.protected = true;
  S.inv.eggshells--;
  M.gift.uses++;
  if (M.gift.firstUseShiftS == null) M.gift.firstUseShiftS = shiftSecs();
  firstAction('use_gift');
  logEvent('gift_used', { plot: e.id });
  e.ring = G.add.ellipse(e.x, e.y - 2, 70, 30).setStrokeStyle(3, 0xfffdf2, 0.95).setDepth(e.y - 0.5);
  toast("🥚 Eggshell ring sprinkled. Slugs won't cross it.");
  renderInventory();
}

function guideMoth(flower) {
  const m = movers.moths.find((x) => !x.target);
  if (!m || flower.state !== 'ready') return;
  firstAction('guide_moth');
  m.target = { gc: flower.c - 0.2, gr: flower.r - 0.2, flower };
}

function bloomMoon(e) {
  if (e.state !== 'ready') return;
  e.state = 'bloom';
  setEmoji(e, '💮');
  bump(e.obj);
  if (e.halo) e.halo.setFillStyle(0xffffff, 0.45);
  M.shift.bloomed++;
  logEvent('bloom', { id: e.id });
  toast('🌙 A moonflower opened!');
  updateGoals();
}

function sendWorm(w) {
  w.state = 'toBin';
  w.dest = { gc: E.bin.c - 0.3, gr: E.bin.r + 0.3 };
  M.shift.wormsSent++;
  firstAction('send_worm');
  logEvent('worm_sent');
}

function pickSlug(s) {
  if (!movers.slugs.includes(s)) return;
  const { x, y } = s.obj;
  removeMover(movers.slugs, s);
  M.shift.slugsPicked++;
  firstAction('pick_slug');
  logEvent('slug_picked');
  floatText(x, y, '✋');
}

function sendFrog(slug) {
  const f = E.frog;
  if (f.state !== 'idle' || !movers.slugs.length) return;
  f.state = 'hunt';
  f.target = slug && movers.slugs.includes(slug) ? slug : nearestSlug(f);
  firstAction('send_frog');
  logEvent('frog_sent');
}

function nearestSlug(f) {
  let best = null;
  let bd = Infinity;
  for (const s of movers.slugs) {
    const d = Math.hypot(s.gc - f.gc, s.gr - f.gr);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function catchFirefly(f) {
  const { x, y } = f.obj;
  removeMover(movers.fireflies, f);
  S.inv.fireflies++;
  M.shift.fireflies++;
  firstAction('catch_firefly');
  floatText(x, y, '+1 ✨');
  renderInventory();
}

// ---------- movers ----------

function removeMover(list, m) {
  const i = list.indexOf(m);
  if (i >= 0) list.splice(i, 1);
  if (S.bubble === m) closeBubble();
  m.obj.destroy();
}

function spawnDew() {
  // dew beads on the glass walls and on the leaves
  const spots = [[rand(0.5, 7), 0.15], [0.15, rand(0.5, 7)], ...BEDS.map(([c, r]) => [c + rand(-0.3, 0.3), r + rand(-0.3, 0.3)])];
  const [gc, gr] = pick(spots);
  const d = { kind: 'dew', gc, gr, life: 11 };
  d.obj = emoji(G, 0, 0, '💧', 20, 0);
  makeTappable(d.obj, d, 16);
  placeMover(d, gr < 0.3 || gc < 0.3 ? 30 : 6);
  G.tweens.add({ targets: d.obj, scale: { from: 0, to: 1 }, duration: 400, ease: 'Back.Out' });
  movers.dews.push(d);
}

function spawnFirefly(gc, gr) {
  const f = { kind: 'firefly', ac: gc, ar: gr, phase: rand(0, 6) };
  const p = iso(gc, gr);
  f.obj = G.add.circle(p.x, p.y - 30, 5, 0xfff27a, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_GLOW + 1);
  f.obj.setInteractive(new Phaser.Geom.Circle(5, 5, 22), Phaser.Geom.Circle.Contains);
  f.obj.ent = f;
  G.tweens.add({ targets: f.obj, alpha: 0.35, duration: rand(500, 900), yoyo: true, repeat: -1 });
  movers.fireflies.push(f);
}

function moonAndJasmine() {
  return ['moonA', 'moonB', 'moonC', 'jasA', 'jasB'].map((id) => E[id]).filter((e) => e.state !== 'nibbled');
}

function spawnSlug() {
  const targets = moonAndJasmine();
  if (!targets.length) return;
  const fromFront = Math.random() < 0.5;
  const s = {
    kind: 'slug', target: pick(targets), state: 'go',
    gc: fromFront ? rand(1, 6) : 7.9, gr: fromFront ? 7.9 : rand(1, 6),
  };
  s.home = { gc: s.gc, gr: s.gr };
  s.obj = emoji(G, 0, 0, '🐌', 26, 0);
  makeTappable(s.obj, s, 14);
  placeMover(s);
  movers.slugs.push(s);
}

function moveToward(m, gc, gr, speed, dt) {
  const dx = gc - m.gc;
  const dy = gr - m.gr;
  const d = Math.hypot(dx, dy);
  if (d <= speed * dt) { m.gc = gc; m.gr = gr; return true; }
  m.gc += (dx / d) * speed * dt;
  m.gr += (dy / d) * speed * dt;
  // screen x grows with (c - r); emoji face left by default
  if (m.obj.setFlipX) m.obj.setFlipX(dx - dy > 0);
  return false;
}

// ---------- main loop ----------

function tick(dt) {
  positionBubble();
  if (S.mode !== 'night' || S.paused) return;
  S.t += dt;

  const hours = 18 + (S.t / CONFIG.shiftSeconds) * 12;
  const h = Math.floor(hours) % 24;
  const mm = Math.floor(((hours % 1) * 60) / 10) * 10;
  setClock(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);

  // dew forms on glass and leaves
  S.dewTimer -= dt;
  if (S.dewTimer <= 0) { S.dewTimer = 4; if (movers.dews.length < 5) spawnDew(); }
  for (const d of [...movers.dews]) { d.life -= dt; if (d.life <= 0) removeMover(movers.dews, d); }

  // dew collector fills slowly
  const dc = E.dewc;
  dc.timer -= dt;
  if (dc.timer <= 0) { dc.timer = 12; dc.amount = Math.min(5, dc.amount + 1); }
  dc.label.setText(`dew collector (${dc.amount})`);

  // compost bin
  const bin = E.bin;
  if (bin.queue > 0) {
    bin.timer -= dt * (1 + bin.worms);
    if (bin.timer <= 0) {
      bin.timer = 6;
      bin.queue--;
      S.inv.compost++;
      M.shift.compost++;
      floatText(bin.x, bin.y - 50, '+1 🟤');
      renderInventory();
      updateGoals();
    }
  }
  bin.label.setText(bin.queue ? `compost bin (${bin.queue} 🍂)` : 'compost bin');

  // moths: wander, or fly to a moonflower and pollinate it
  for (const m of movers.moths) {
    if (m.target) {
      if (moveToward(m, m.target.gc, m.target.gr, 2.2, dt) && !m.target.arrived) {
        m.target.arrived = true;
        const f = m.target.flower;
        G.time.delayedCall(600, () => { bloomMoon(f); m.target = null; });
      }
      placeMover(m, 46);
    } else {
      m.phase += dt;
      m.gc = m.home.gc + Math.sin(m.phase * 0.5) * 1.6;
      m.gr = m.home.gr + Math.sin(m.phase * 0.8) * 1.2;
      placeMover(m, 60 + Math.sin(m.phase * 3) * 8);
    }
  }

  // fireflies drift around where they were born
  for (const f of movers.fireflies) {
    f.phase += dt;
    const p = iso(f.ac + Math.sin(f.phase * 0.7) * 0.5, f.ar + Math.cos(f.phase * 0.5) * 0.5);
    f.obj.setPosition(p.x, p.y - 40 - Math.sin(f.phase * 2) * 10);
  }

  // worms
  for (const w of [...movers.worms]) {
    if (w.state === 'toBin') {
      if (moveToward(w, w.dest.gc, w.dest.gr, 0.9, dt)) {
        bin.worms++;
        removeMover(movers.worms, w);
        floatText(bin.x, bin.y - 50, '🪱 joined the bin');
        continue;
      }
    } else if (!w.dest || moveToward(w, w.dest.gc, w.dest.gr, 0.15, dt)) {
      w.dest = { gc: rand(1, 6), gr: rand(1, 6) };
    }
    placeMover(w);
  }

  // slugs arrive mid-shift
  if (S.slugEvent === 'pending' && S.t >= CONFIG.slugStart) {
    S.slugEvent = 'active';
    S.slugTimer = 6;
    for (let i = 0; i < 3; i++) spawnSlug();
    logEvent('slugs_arrive');
    toast('🐌 Slugs are sliding in toward the flowers!', 3000);
  }
  if (S.slugEvent === 'active') {
    S.slugTimer -= dt;
    if (S.slugTimer <= 0) { S.slugTimer = 6; spawnSlug(); }
    if (S.t >= CONFIG.slugEnd) { S.slugEvent = 'done'; logEvent('slugs_leave'); }
  }
  updateSlugs(dt);
  updateFrog(dt);

  if (S.t >= CONFIG.shiftSeconds) endShift(false);
}

function updateSlugs(dt) {
  for (const s of [...movers.slugs]) {
    if (s.state === 'go' && (s.target.state === 'nibbled' || S.slugEvent === 'done')) {
      const others = moonAndJasmine();
      if (others.length && S.slugEvent !== 'done') s.target = others[0];
      else s.state = 'flee';
    }
    if (s.state === 'flee') {
      if (moveToward(s, s.home.gc, s.home.gr, 0.8, dt)) { removeMover(movers.slugs, s); continue; }
    } else {
      const d = Math.hypot(s.target.c - s.gc, s.target.r - s.gr);
      if (s.target.protected && d < 0.75) {
        s.state = 'flee';
        M.shift.slugsRepelled++;
        logEvent('slug_repelled', { id: s.target.id });
        floatText(s.obj.x, s.obj.y, '🥚 nope!');
      } else if (d < 0.2) {
        nibble(s.target);
        s.state = 'flee';
      } else {
        moveToward(s, s.target.c, s.target.r, 0.32, dt);
      }
    }
    placeMover(s);
  }
}

function nibble(e) {
  e.state = 'nibbled';
  setEmoji(e, '🥀');
  if (e.halo) { e.halo.destroy(); e.halo = null; }
  M.shift.nibbled++;
  logEvent('nibbled', { id: e.id });
  toast('🥀 A slug nibbled a flower…');
  updateGoals();
}

function updateFrog(dt) {
  const f = E.frog;
  if (f.state === 'hunt') {
    if (!f.target || !movers.slugs.includes(f.target)) f.target = nearestSlug(f);
    if (!f.target) { f.state = 'home'; return; }
    if (moveToward(f, f.target.gc, f.target.gr, 1.6, dt)) {
      const { x, y } = f.target.obj;
      removeMover(movers.slugs, f.target);
      M.shift.slugsByFrog++;
      logEvent('slug_eaten_by_frog');
      floatText(x, y, '🐸 gulp!');
      f.target = nearestSlug(f);
      if (!f.target) f.state = 'home';
    }
  } else if (f.state === 'home') {
    if (moveToward(f, f.home.gc, f.home.gr, 1.4, dt)) f.state = 'idle';
  } else {
    return;
  }
  f.hop = (f.hop || 0) + dt * 9;
  placeMover(f, Math.abs(Math.sin(f.hop)) * 14);
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
  logEvent('journal_reopen', { from: 'button' });
  showJournal(false);
});

// ===========================================================================
// 5. Handover at dawn
// ===========================================================================

function endShift(early) {
  S.mode = 'handover';
  S.paused = true;
  closeBubble();
  M.shift.endedEarly = early;
  M.shift.lengthS = shiftSecs();
  logEvent('shift_end', { early });
  [...movers.slugs].forEach((s) => removeMover(movers.slugs, s));
  setSky('dawn');
  setClock('06:00');
  setPhase('Dawn: handover to Sol');
  ['#bar', '#goals', '#btn-journal', '#btn-end'].forEach((s) => $(s).classList.add('hidden'));
  G.scale.refresh();

  const sh = M.shift;
  const gifts = [
    { id: 'fireflies', label: `✨ A jar of fireflies (${S.inv.fireflies} caught)`, ok: S.inv.fireflies > 0 },
    { id: 'petal', label: '💮 A moonflower petal', ok: sh.bloomed > 0 },
    { id: 'dew', label: '💧 A vial of night dew', ok: S.inv.dew > 0 },
    { id: 'none', label: 'No gift this time', ok: true },
  ];
  const firstOk = gifts.find((g) => g.ok).id;
  const panel = showPanel(`
    <h2>🌅 Dawn: hand over to Sol</h2>
    <p>Sol will wake up to:</p>
    <ul class="list">
      <li>💮 ${sh.bloomed}/3 moonflowers · 🌼 ${sh.jasmine}/2 jasmine${sh.nibbled ? ` · 🥀 ${sh.nibbled} nibbled` : ''}</li>
      <li>🍄 mushrooms lv ${E.mush.level} · 🟤 ${S.inv.compost} compost · 💧 ${S.inv.dew} dew for the morning</li>
    </ul>
    <label class="field">Leave Sol a note (optional)<textarea id="note" rows="3" maxlength="240"></textarea></label>
    <p><b>Pack a gift Sol can't get by day:</b></p>
    ${gifts.map((g) => `<label class="choice ${g.ok ? '' : 'disabled'}"><input type="radio" name="gift" value="${g.id}" ${g.ok ? '' : 'disabled'} ${g.id === firstOk ? 'checked' : ''}> ${g.label}</label>`).join('')}
    <button class="primary" id="handover">Hand over to Sol ☀️</button>`);
  panel.querySelector('#handover').onclick = () => {
    M.handover.note = panel.querySelector('#note').value.trim();
    M.handover.giftPacked = panel.querySelector('input[name=gift]:checked').value;
    logEvent('handover', { noteChars: M.handover.note.length, gift: M.handover.giftPacked });
    showRecall();
  };
}

// ===========================================================================
// 6. Recall check + results (for the playtest)
// ===========================================================================

const RECALL = [
  { text: 'Watered the moonflowers', truth: true },
  { text: 'Fixed a crack in the glass wall', truth: false },
  { text: 'Planted a new sunflower', truth: true },
  { text: 'Raked leaves into the basket', truth: true },
  { text: 'Fed the frog', truth: false },
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
  const mk = M.markers;
  const panel = showPanel(`
    <h2>Thanks for playing 🌙</h2>
    <p class="sub">Playtest summary${M.tester ? ` · ${M.tester}` : ''} · feel ${M.variant.feel} · recap ${M.variant.recap}</p>
    <ul class="list results">
      <li><b>Recap</b> ${r.seconds}s · ${r.skipped ? `skipped at step ${r.stepReached}/${r.steps}` : `watched all ${r.steps} steps`}</li>
      <li><b>Journal</b> read ${M.journal.firstReadSeconds}s · reopened ×${M.journal.reopens}</li>
      <li><b>Sol ☀️</b> visited ${mk.visited.length}/${mk.total} markers${mk.visited.length ? ` (first at ${fmt(mk.visited[0].t)})` : ''}</li>
      <li><b>Gift</b> ${g.openedWhere ? `opened in ${g.openedWhere}${g.openedWhere !== 'journal' ? ` at ${fmt(g.openedAtShiftS)}` : ''}` : 'never opened'} · ${g.uses ? `first used at ${fmt(g.firstUseShiftS)} (×${g.uses})` : 'never used'}</li>
      <li><b>Leaves</b> ${sh.leavesTakenS != null ? `taken at ${fmt(sh.leavesTakenS)}` : 'never taken'} · compost ${sh.compost} · mushrooms fed ×${sh.mushroomFeeds}</li>
      <li><b>Flowers</b> moon ${sh.bloomed}/3 · jasmine ${sh.jasmine}/2 · nibbled ${sh.nibbled}</li>
      <li><b>Slugs</b> picked ${sh.slugsPicked} · frog ${sh.slugsByFrog} · repelled ${sh.slugsRepelled}</li>
      <li><b>Other</b> dew ${sh.dew} · fireflies ${sh.fireflies} · worms sent ${sh.wormsSent}</li>
      <li><b>First</b> ${sh.firstAction || '—'} at ${fmt(sh.firstActionS)} · shift ${fmt(sh.lengthS)}${sh.endedEarly ? ' (ended early)' : ''}</li>
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

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'scene',
  backgroundColor: '#e7956b',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: [GreenhouseScene],
  banner: false,
});
