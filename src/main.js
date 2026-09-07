// Agents Office v2 — Three.js isometric office with zoom-driven LOD
// Far: clean pods + agent counts (Image 1 read). Near: diorama with 3D people + holo screens (Image 2 read).
import * as THREE from 'three';
import { TOKENS, DEPTS, DEPT_KEYS, AGENTS, LAYOUT, WORKLINES, APPROVAL_ASKS, APPROVAL_BY_AGENT } from './data.js';
import { V1, FILE_GEN, STATS, KPIS, P, rnd, ri, person, money } from './v1data.js';
import {
  PLINTH_H, mat, rbox, makePlinth, makeFloorTitle, makeDesk, makeChair,
  makePerson, posePerson, poseWork, makePlant, makeServerRack, makeMeetingTable, makeWalkway, makeWarnSprite,
} from './builders.js';
import { initMcp } from './mcp.js';
import { loadConnectors } from './connectors.js';
import { initTasks } from './tasks.js';
import { initBrain } from './brain.js';
let tasks = null; // V3 task boards — initialised after the rail constants exist

/* ---------- renderer / scene / camera ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();

const FR = 42; // frustum half-height at zoom 1
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800);
const ISO = new THREE.Vector3(1, 0.92, 1).normalize();
const CAM_DIST = 220;
// V3.2 overview (AJ, 5 Sep late): every dept card sits ON its own pod, over the wiring. With six
// pods the scene is pulled back to 0.86 and shifted down so the EMAILS and DELIVERY cards can
// float above their back rows instead of being shoved out to the screen edges.
// V3.3: the Task Status panel owns the right ~430px at every zoom, so the overview target slides
// along screen-right by half the panel width — the scene sits centred in what is left.
const OVERVIEW = { base: [-9, 0, -9], zoom: 0.8 }; // (-9,-9) shifts the scene straight DOWN the screen, no sideways drift
const SR_ = new THREE.Vector3(1, 0, -1).normalize();
function overviewPos() {
  const pw = (tasks ? tasks.panelWidth() : 400) + 30;
  const ppw = OVERVIEW.zoom * innerHeight / (2 * FR);
  const sh = (pw / 2) / ppw;
  return [OVERVIEW.base[0] + SR_.x * sh, 0, OVERVIEW.base[2] + SR_.z * sh];
}
const view = { target: new THREE.Vector3(...overviewPos()), zoom: OVERVIEW.zoom, arc: 0 };
let tween = null;
const UPV = new THREE.Vector3(0, 1, 0);
const isoWork = new THREE.Vector3();

function applyCamera() {
  const aspect = innerWidth / innerHeight;
  camera.left = -FR * aspect; camera.right = FR * aspect;
  camera.top = FR; camera.bottom = -FR;
  camera.zoom = view.zoom;
  isoWork.copy(ISO);
  if (view.arc) isoWork.applyAxisAngle(UPV, view.arc); // cinematic swing-in, settles back to locked iso
  camera.position.copy(view.target).addScaledVector(isoWork, CAM_DIST);
  camera.lookAt(view.target);
  camera.updateProjectionMatrix();
}

// house easing cubic-bezier(0.2, 0.8, 0.2, 1)
function bezier(t) {
  const cx = 3 * 0.2, bx = 3 * (0.2 - 0.2) - cx, ax = 1 - cx - bx;
  const cy = 3 * 0.8, by = 3 * (1 - 0.8) - cy, ay = 1 - cy - by;
  let u = t;
  for (let i = 0; i < 5; i++) {
    const x = ((ax * u + bx) * u + cx) * u - t;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(dx) < 1e-6) break;
    u -= x / dx;
  }
  return ((ay * u + by) * u + cy) * u;
}

function flyTo(targetPos, zoom, dur = 800, opts = {}) {
  tween = {
    t0: performance.now(), dur,
    fromT: view.target.clone(), toT: new THREE.Vector3(...targetPos),
    fromZ: view.zoom, toZ: zoom,
    arc: opts.arc || 0, onDone: opts.onDone,
  };
}
function tickTween(now) {
  if (!tween) return;
  const k = Math.min(1, (now - tween.t0) / tween.dur);
  const e = bezier(k);
  view.target.lerpVectors(tween.fromT, tween.toT, e);
  view.zoom = tween.fromZ + (tween.toZ - tween.fromZ) * e;
  view.arc = Math.sin(e * Math.PI) * tween.arc;
  if (k >= 1) {
    const cb = tween.onDone;
    view.arc = 0; tween = null;
    if (cb) cb();
  }
}

/* ---------- lights: one warm key top-left + soft fill ---------- */
const hemi = new THREE.HemisphereLight(0xfdfff8, 0xd8d4c8, 0.85);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff1dd, 2.2);
key.position.set(-60, 90, 20);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -95; key.shadow.camera.right = 95;
key.shadow.camera.top = 95; key.shadow.camera.bottom = -95;
key.shadow.camera.far = 400;
key.shadow.radius = 7; key.shadow.blurSamples = 12;
key.shadow.bias = -0.0004;
scene.add(key);

// shadow catcher — makes the pods float over the cream page
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.ShadowMaterial({ opacity: 0.13 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -7;
ground.receiveShadow = true;
scene.add(ground);

/* ---------- build the office ---------- */
const hud = document.getElementById('hud');
const clickTargets = [];   // plinth meshes -> dept key
const personTargets = [];  // person meshes -> agent id
const R = {};              // runtime per agent
const deptRT = {};         // runtime per dept
const screenSets = [];

for (const [key_, L] of Object.entries(LAYOUT)) {
  const dept = DEPTS[key_];
  const g = new THREE.Group();
  g.position.set(L.pos[0], 0, L.pos[1]);
  const plinth = makePlinth(L.w, L.d, dept.floor);
  g.add(plinth);
  plinth.traverse(o => { if (o.isMesh) { o.userData.dept = key_; clickTargets.push(o); } });
  plinth.children[0].userData.part = 'plinth'; plinth.children[1].userData.part = 'floor'; plinth.children[1].userData.chip = dept.chip; // dark mode re-tints these

  // no floor titles — the billboards name each department (AJ's call, M2.3)
  scene.add(g);
  deptRT[key_] = { group: g, L };
}

// brain centre (V3.6, AJ 6 Sep 2026): the particle nebula is RETIRED. The vault's wiki-link graph
// is etched into the pod floor (src/brain.js); reads glint, writes add notes, G opens the full graph.
let brain;
{
  const bg = deptRT.brain.group;
  brain = initBrain({ scene, brainGroup: bg, getR: () => R, esc: (t) => esc(t), hud, toScreen: (p) => toScreen(p), getCamera: () => camera });
  const plant = makePlant(); plant.position.set(6.2, 0.12, -5.8); bg.add(plant);
}

/* the thinking sweep (M4, D): a soft comet orbits the brain; as it passes each dept's
   azimuth that dept "lights up" — brain particles lean toward its chip colour (handled in
   makeNeuralBrain) and its billboard gets a chip-coloured glow. Ref: AJ's galaxy video,
   departments highlighted one at a time. */
const SWEEP_PERIOD = 16000; // ms per full orbit
const DEPT_AZ = {};
for (const k of DEPT_KEYS)
  DEPT_AZ[k] = Math.atan2(LAYOUT[k].pos[1], LAYOUT[k].pos[0]);
function tickSweep(now) {
  // the sweep is overview theatre — it bows out while a dept is focused
  const on = (!focused || focused === 'brain') ? 1 : 1 - focusDim;
  const theta = (now % SWEEP_PERIOD) / SWEEP_PERIOD * Math.PI * 2;
  let domDept = null, domS = 0;
  for (const [k, az] of Object.entries(DEPT_AZ)) {
    const d = Math.atan2(Math.sin(theta - az), Math.cos(theta - az));
    let s = Math.max(0, 1 - Math.abs(d) / 0.7);
    s = s * s * (3 - 2 * s) * on;
    if (s > domS) { domS = s; domDept = k; }
    const b = deptRT[k].badge;
    if (s > 0.55 && !b.classList.contains('sweepglow')) {
      b.style.setProperty('--sw', DEPTS[k].chip);
      b.classList.add('sweepglow');
    } else if (s <= 0.35 && b.classList.contains('sweepglow')) b.classList.remove('sweepglow');
  }
  // (the M4 orbiting comet is retired per AJ — the sweep now shows only as the badge glow
  //  + the brain particles leaning toward the visiting dept's colour)
  return { theta, strength: domS, col: domDept ? DEPTS[domDept].chip : '#FFFFFF' };
}

// walkways dept -> brain
for (const k of DEPT_KEYS) {
  const L = LAYOUT[k];
  const sx = Math.sign(L.pos[0]), sz = Math.sign(L.pos[1]);
  const from = [L.pos[0] - sx * (L.w / 2 - 1), L.pos[1] - sz * (L.d / 2 - 1)];
  const to = [sx * 6.5, sz * 6.5];
  const walk = makeWalkway(from, to);
  walk.userData.dept = k; walk.userData.part = 'walkway';
  scene.add(walk);
  deptRT[k].gate = new THREE.Vector3(from[0], 0, from[1]);
  deptRT[k].brainGate = new THREE.Vector3(to[0], 0, to[1]);
}
// tag remaining brain furnishings (plinth, plant) for the focus-dim pass — these DO go
// dark in galaxy mode, unlike the 'brainCore' nebula tagged above
deptRT.brain.group.traverse(o => { if ((o.isMesh || o.isSprite) && !o.userData.dept) o.userData.dept = 'brain'; });

/* (M5.3 per AJ: the bridge cables are gone — the walkways alone carry the connection;
   the brain↔dept relationship shows through the badge sweep + meetings.) */

/* desks + people per dept */
const COLS = { emails: 2, sales: 2, marketing: 2, ops: 2, fin: 2, delivery: 2 };
for (const a of AGENTS) {
  const dRT = deptRT[a.dept];
  const dept = DEPTS[a.dept];
  const L = dRT.L;
  const cols = COLS[a.dept];
  const gx = (a.grid[0] - (cols - 1) / 2) * 8.6;
  const gz = (a.grid[1] - 1) * 6.4 - 1;
  const base = new THREE.Vector3(L.pos[0] + gx, 0.12, L.pos[1] + gz);

  // whole station rotated 45° so monitor screens face the camera square-on
  const ANG = Math.PI / 4;
  const rot = (v) => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), ANG);

  const station = new THREE.Group();
  station.position.copy(base);
  station.rotation.y = ANG;
  const { group: desk, screenSet } = makeDesk(dept.chip);
  station.add(desk);
  screenSets.push({ screenSet, dept: a.dept });
  const chair = makeChair();
  chair.position.set(0, 0, 1.75);
  station.add(chair);
  station.traverse(o => { if (o.isMesh) o.userData.dept = a.dept; }); // focus-dim tagging
  scene.add(station);

  const person = makePerson({ hair: a.hair, skin: a.skin, chip: dept.chip, lead: a.lead });
  person.position.copy(base).add(rot(new THREE.Vector3(0, 0, 1.7)));
  person.rotation.y = ANG + Math.PI; // face the monitor
  person.traverse(o => { if (o.isMesh) { o.userData.agentId = a.id; o.userData.dept = a.dept; personTargets.push(o); } });
  scene.add(person);

  const warn = makeWarnSprite();
  warn.visible = false;
  scene.add(warn);

  // name pill (HTML) — clickable, same as clicking the agent
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.innerHTML = (a.lead ? '<span class="star">★</span>' : '') + a.name;
  pill.addEventListener('click', () => openAgent(a.id, 'chat'));
  hud.appendChild(pill);

  R[a.id] = {
    a, person, warn, pill, seat: person.position.clone(), seatRot: ANG + Math.PI,
    stand: person.position.clone().add(rot(new THREE.Vector3(1.5, 0, 0.15))),
    state: 'working', bob: Math.random() * 10, path: null, pathI: 0, speed: 9.5, ask: null,
    v1: V1.find(x => x.id === a.id), feed: [],
  };
}

/* CONNECTORS — per-dept dock of MCP logos with back-and-forth traffic (AJ's spec, 2 Aug rev 2)
   V3.1: served, the list is the user's REAL MCP servers (GET /api/mcp) — the strip waits for it.
   Opened as a file the demo list plays at once. `mcp` is a thin proxy so the rest of the office
   never cares which it got. */
let mcpImpl = null, mcpDark = false;
const mcp = {
  sprites: [],
  tick: (...a) => mcpImpl && mcpImpl.tick(...a),
  onAgentEvent: (...a) => mcpImpl && mcpImpl.onAgentEvent(...a),
  onToolsUsed: (...a) => mcpImpl && mcpImpl.onToolsUsed(...a),
  showTip: (...a) => mcpImpl && mcpImpl.showTip(...a),
  startReveal: (...a) => mcpImpl && mcpImpl.startReveal(...a),
  setDark: on => { mcpDark = on; if (mcpImpl) mcpImpl.setDark(on); },
  isLive: () => !!(mcpImpl && mcpImpl.live),
};
loadConnectors().then(c => { mcpImpl = initMcp({ scene, hud, LAYOUT, DEPTS, FR, R, connectors: c }); if (mcpDark) mcpImpl.setDark(true); });

// plants on outer corners
for (const k of ['emails', 'sales', 'marketing', 'ops', 'delivery']) {
  const L = LAYOUT[k];
  const sx = Math.sign(L.pos[0]), sz = Math.sign(L.pos[1]);
  const p = makePlant();
  p.position.set(L.pos[0] + sx * (L.w / 2 - 1.6), 0.12, L.pos[1] + sz * (L.d / 2 - 1.6));
  p.traverse(o => { if (o.isMesh) o.userData.dept = k; });
  scene.add(p);
}

/* ---------- focus dim: unfocused depts genuinely darken/desaturate in-scene ---------- */
let focusDimTarget = 0, focusDim = 0;
const dimSwapped = [];
const dimCache = new Map();
function dimTwin(m) {
  if (!dimCache.has(m.uuid)) {
    const d = m.clone();
    d.userData.baseColor = m.color.clone();
    const l = (m.color.r + m.color.g + m.color.b) / 3;
    d.userData.dimColor = new THREE.Color(l * 0.40 + 0.10, l * 0.40 + 0.10, l * 0.38 + 0.09);
    dimCache.set(m.uuid, d);
  }
  return dimCache.get(m.uuid);
}
function applySceneDim(deptKey) {
  restoreSceneDim();
  scene.traverse(o => {
    if (!(o.isMesh || o.isLine || o.isSprite) || !o.material || o.material.isShadowMaterial || !o.userData.dept) return;
    if (o.userData.dept === deptKey) return;
    if (deptKey === 'brain' && o.userData.dept === 'brainCore') return; // brain focus keeps its nebula lit
    dimSwapped.push({ mesh: o, orig: o.material });
    o.material = dimTwin(o.material);
  });
}
function restoreSceneDim() {
  for (const s of dimSwapped) s.mesh.material = s.orig;
  dimSwapped.length = 0;
}
function tickDim(dt) {
  focusDim += (focusDimTarget - focusDim) * (1 - Math.exp(-dt * 5));
  if (focusDimTarget === 0 && focusDim < 0.02 && dimSwapped.length) restoreSceneDim();
  for (const m of dimCache.values())
    m.color.copy(m.userData.baseColor).lerp(m.userData.dimColor, focusDim);
}

/* ---------- department billboards — v1's exact agreed metric rows + amber approval row ---------- */
const kv = id => KPIS.find(k => k.id === id).val;
let brainNotes = brain.state.notes;
const BB_ROWS = {
  emails: [
    ['EMAILS SENT', () => STATS.emailsSent],
    ['REPLIES DRAFTED', () => STATS.drafts]],
  delivery: [
    ['REPORTS SENT', () => STATS.reports],
    ['ON TRACK', () => STATS.onTrack + ' / ' + STATS.projects]],
  sales: [
    ['CALLS S·A·J', () => STATS.spencer + '·' + STATS.arwin + '·' + STATS.jack],
    ['NEW MANAGERS', () => STATS.managers],
    ['AUTO-ONBOARDED', () => STATS.autoOnb]],
  marketing: [
    ['NEW INSIGHTS', () => STATS.insMkt],
    ['COST PER USER', () => '$' + Math.round(STATS.cpa)]],
  ops: [
    ['PROPOSALS MADE', () => Math.round(kv('proposals'))],
    ['NEW INSIGHTS', () => STATS.insOps]],
  fin: [
    ['INVOICES ISSUED', () => Math.round(kv('invoices'))],
    ['BILLS PAID', () => STATS.billsPaid]],
  brain: [
    ['NOTES INDEXED', () => brainNotes.toLocaleString('en-NZ')]],
};
for (const k of [...DEPT_KEYS, 'brain']) {
  const dept = DEPTS[k];
  const n = AGENTS.filter(a => a.dept === k).length;
  const b = document.createElement('div');
  b.className = 'badge';
  b.innerHTML = `
    <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${dept.short}<span class="live"></span></div>
    <div class="b-count">${k === 'brain' ? '<span class="b-num">∞</span><span class="b-lab">KNOWLEDGE</span>' : `<span class="b-num">${n}</span><span class="b-lab">AGENTS</span>`}</div>
    <div class="b-metrics">${BB_ROWS[k].map((row, i) => `
      <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-m="${k}-${i}">${row[1]()}</span></div>`).join('')}
    </div>
    <div class="b-appr" style="display:none">⚠ <span class="ap-n">1</span> WAITING APPROVAL</div>`;
  b.addEventListener('click', (e) => {
    if (e.target.closest('.b-appr')) { zoomToApproval(k); e.stopPropagation(); }
    else if (e.target.closest('.b-tasks') && tasks) { tasks.openFor(k); e.stopPropagation(); }
    else zoomToDept(k);
  });
  if (k === 'brain') { // V3.6: a small tag names the etched floor and opens the graph (the big card stays retired)
    b.className = 'badge brainTag';
    b.innerHTML = `<div class="b-name"><span class="dot" style="background:${dept.chip}"></span>THE BRAIN<b>${brain.state.notes.toLocaleString('en-NZ')}</b>NOTES</div>`;
    b.onclick = (e) => { e.stopPropagation(); brain.open(); };
    b.title = 'open the Brain (G)';
  }
  hud.appendChild(b);
  deptRT[k].badge = b;
  deptRT[k].vals = BB_ROWS[k].map(row => String(row[1]()));
  deptRT[k].apprRow = b.querySelector('.b-appr');
  deptRT[k].apprN = b.querySelector('.ap-n');
  // anchor just above the FIRST DESK ROW (z-9.6), not the pod edge — keeps the card-to-agents
  // gap consistent across pods of different depths. Support docks to the side instead: its
  // natural spot is off-screen at overview and the clamp used to shove it onto its agents.
  // V3.2 (AJ): every card sits ON its own pod, over the wiring — screen-tuned per pod at the
  // 0.84 overview. Standard = centred above the anchor (back corner, y clears the pills);
  // side = hangs off the pod's edge, vertically centred (fin: its back corner is the Brain;
  // ops: its back corner is the marketing pod's front row).
  const ANCHOR = {
    marketing: [-36, 8.6, 13.4],
    emails:    [-30, 8.6, -32.6],
    delivery:  [0, 10.6, -57.6],   // y 10.6: the top-bar clamp otherwise lands it on the back-row pills
    sales:     [48, 8.6, -32],     // over the pod's right corner — past the DELIVERY pod's desks and the Sales Lead pill
    ops:       [-13.5, 4, 54],     // side LEFT
    fin:       [43.5, 4, 17],      // side RIGHT
    brain:     [-5.5, 3.2, -5.5],  // just above the pod's back corner
  };
  deptRT[k].badgeAnchor = new THREE.Vector3(...ANCHOR[k]);
  if (k === 'fin') deptRT[k].sideBadge = true;
  if (k === 'ops') { deptRT[k].sideBadge = true; deptRT[k].sideLeft = true; }
}
function updateBillboards() {
  for (const k of Object.keys(BB_ROWS)) {
    BB_ROWS[k].forEach((row, i) => {
      const nv = String(row[1]());
      if (nv !== deptRT[k].vals[i]) {
        deptRT[k].vals[i] = nv;
        const el = deptRT[k].badge.querySelector(`[data-m="${k}-${i}"]`);
        if (!el) return; // the brain tag carries no metric rows
        el.textContent = nv;
        el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
        const rel = document.querySelector(`[data-rm="${k}-${i}"]`); // docked rail copy
        if (rel) {
          rel.textContent = nv;
          rel.classList.remove('flash'); void rel.offsetWidth; rel.classList.add('flash');
        }
      }
    });
  }
}

/* ---------- meeting bubble ---------- */
const bubble = makeBubbleSprite();
bubble.position.set(2, 5.4, 2); // meetings happen beneath the floating brain
bubble.visible = false;
scene.add(bubble);
function makeBubbleSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.font = '96px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('💬', 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(4, 4, 1);
  return s;
}

/* ---------- controls: wheel zoom-to-cursor, drag pan, click to fly ---------- */
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function worldAt(nx, ny) {
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const p = new THREE.Vector3();
  ray.ray.intersectPlane(groundPlane, p);
  return p;
}
let focused = null; // dept key when zoomed into a dept

addEventListener('wheel', (e) => {
  if (e.target.closest && e.target.closest('#rail')) return; // let the rail scroll
  e.preventDefault();
  tween = null;
  view.arc = 0;
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  const before = worldAt(nx, ny);
  view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0032), 0.72, 5.2);
  applyCamera();
  const after = worldAt(nx, ny);
  if (before && after) view.target.add(before.sub(after));
  if (view.zoom < 1.6 && focused) {
    if (focused === 'brain') focused = null; else exitFocus(false);
  }
  syncOverviewBtn();
}, { passive: false });

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
});
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (drag.moved) {
    tween = null;
    const a = worldAt((drag.x / innerWidth) * 2 - 1, -(drag.y / innerHeight) * 2 + 1);
    const b = worldAt((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (a && b) view.target.add(a.sub(b));
    drag.x = e.clientX; drag.y = e.clientY;
  }
});
addEventListener('pointerup', (e) => {
  const wasDrag = drag && drag.moved;
  drag = null;
  if (wasDrag) return;
  if (e.target !== canvas) return; // HTML chrome handles its own clicks
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const mHits = ray.intersectObjects(mcp.sprites, false);
  if (mHits.length) { // MCP logo tile → pulse + connection tooltip
    mcp.showTip(mHits[0].object, e.clientX, e.clientY, performance.now());
    return;
  }
  const pHits = ray.intersectObjects(personTargets, false);
  if (pHits.length) {
    // clicking an agent opens its rail — a stuck agent opens straight to Chat (v1 rule)
    openAgent(pHits[0].object.userData.agentId, 'chat');
    return;
  }
  const hits = ray.intersectObjects(clickTargets, false);
  if (hits.length) {
    const dk = hits[0].object.userData.dept;
    if (dk === 'brain') { brain.open(); return; } // V3.6: the Brain opens as the graph
    if (dk !== focused) enterFocus(dk);
  }
});
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') { if (brain.isOpen()) brain.close(); else if (tasks && tasks.isOpen()) tasks.close(); else zoomOut(); }
  else if (e.key === 'g' || e.key === 'G') brain.toggle(); // V3.6: the full-screen Brain graph
  else if (e.key === 'b' || e.key === 'B') { if (tasks) tasks.toggle(); } // V3: the company-wide board
  else if (e.key === '+' || e.key === '=') zoomStep(1.5);
  else if (e.key === '-' || e.key === '_') zoomStep(1 / 1.5);
  else if (e.key === '0') zoomOut();
  else if (e.key === 'x' || e.key === 'X') { if (!meeting) planMeeting(performance.now()); }
  else if (e.key >= '1' && e.key <= '6') { // jump straight to a department
    const dept = ['marketing', 'emails', 'sales', 'ops', 'fin', 'delivery'][+e.key - 1];
    if (focused !== dept) enterFocus(dept);
  }
  else if (e.key === 'c' || e.key === 'C') { // in a department: open its (lead) agent's chat
    if (focused && focused !== 'brain') {
      const a = AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused);
      if (a) openAgentRail(a.id, 'chat');
    }
  }
  else if (e.key === 'v' || e.key === 'V') setCam(!document.body.classList.contains('cam'));
  else if (e.key === 'd' || e.key === 'D') setDark(!darkOn);
  else if (e.key === 'w' || e.key === 'W') requestApproval('apay'); // demo cue: Accounts Payable asks for approval
});

// camera mode: mid-tone backdrop for filming the screen (#cam=1 / V toggles)
function setCam(on) { document.body.classList.toggle('cam', !!on); }
// DARK MODE (AJ, 6 Sep 2026: "make another one in dark mode as I will show both"): D toggles, #dark=1
// forces it, /dark on the server opens in it. The chrome follows the CSS tokens; the scene
// re-tints its shared materials (plinths, floors, walkways), relights, and the Brain/wires swap ink.
let darkOn = false;
const DARK = { plinth: 0x2c2d2b, walkway: 0x303230, ground: 0x1b1c1a };
function mix(hex, base, k) { const a = new THREE.Color(hex), b = new THREE.Color(base); return b.lerp(a, k); }
function setDark(on) {
  darkOn = !!on;
  document.body.classList.toggle('dark', darkOn);
  restoreSceneDim(); dimCache.clear(); // the dim twins cache base colours — rebuild them for the new palette
  scene.traverse(o => {
    if (!o.isMesh || !o.userData.part) return;
    const m = o.material; if (!m.userData.base) m.userData.base = m.color.clone();
    if (o.userData.part === 'plinth') m.color.set(darkOn ? DARK.plinth : m.userData.base);
    else if (o.userData.part === 'walkway') m.color.set(darkOn ? DARK.walkway : m.userData.base);
    else if (o.userData.part === 'floor') m.color.copy(darkOn ? mix(o.userData.chip, '#1b1c1a', o.userData.dept === 'brain' ? 0.07 : 0.22) : m.userData.base); // the Brain's pale sage needs a lighter touch
  });
  hemi.color.set(darkOn ? 0x8e95a3 : 0xfdfff8); hemi.groundColor.set(darkOn ? 0x14151a : 0xd8d4c8); hemi.intensity = darkOn ? 0.75 : 0.85;
  key.color.set(darkOn ? 0xe4e9f2 : 0xfff1dd); key.intensity = darkOn ? 1.5 : 2.2;
  ground.material.opacity = darkOn ? 0.35 : 0.13;
  if (focused && focused !== 'brain') applySceneDim(focused);
  if (brain) brain.setTheme(darkOn);
  mcp.setDark(darkOn);
}

// double-click empty space → straight back to overview
canvas.addEventListener('dblclick', (e) => {
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  if (!ray.intersectObjects(clickTargets, false).length) zoomOut();
});

// on-screen zoom controls
function zoomStep(f) {
  flyTo([view.target.x, 0, view.target.z], clamp(view.zoom * f, 0.72, 5.2), 350);
  if (view.zoom * f < 1.6 && focused) {
    if (focused === 'brain') focused = null; else exitFocus(false);
  }
  syncOverviewBtn();
}
document.getElementById('zIn').addEventListener('click', () => zoomStep(1.5));
document.getElementById('zOut').addEventListener('click', () => zoomStep(1 / 1.5));
document.getElementById('zHome').addEventListener('click', zoomOut);

function zoomToDept(k) { enterFocus(k); }
function zoomOut() {
  if (focused && focused !== 'brain') { exitFocus(true); return; }
  focused = null;
  flyTo(overviewPos(), OVERVIEW.zoom, 550);
  syncOverviewBtn();
}
document.getElementById('overviewBtn').addEventListener('click', zoomOut);
function syncOverviewBtn() {
  document.getElementById('overviewBtn').classList.toggle('show',
    (view.zoom > 1.45 && !(tween && tween.toZ <= OVERVIEW.zoom + 0.05)) || !!focused);
}

/* ---------- focus rail: dept billboard + activity rows; agent CHAT & ACTIVITY slide-over ---------- */
const chatHist = {};
const rail = document.getElementById('rail');
const vignette = document.getElementById('vignette');
const mMsgs = document.getElementById('mMsgs');
let modalOpen = null, modalTab = 'chat'; // modalOpen = agent id open in the rail slide-over
// V3.3: the rail docks LEFT for every department — the task panel has the right side
const RAIL_SIDE = { marketing: 'left', emails: 'left', sales: 'left', ops: 'left', fin: 'left', delivery: 'left' };
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();

function ensureChat(id) {
  if (chatHist[id]) return;
  const v = R[id].v1;
  chatHist[id] = [
    { who: 'agent', text: v.greeting },
    { who: 'work', i: '⏺', text: 'session attached — live work stream below' },
  ];
  if (FILE_GEN[id] && !(tasks && tasks.isLive())) chatHist[id].push({ who: 'file', ...FILE_GEN[id]() }); // demo-only sample file; a live office shows real deliverables
}
function chatPush(id, msg) {
  ensureChat(id);
  chatHist[id].push(msg);
  if (chatHist[id].length > 80) chatHist[id].splice(2, 1);
  if (modalOpen === id && modalTab === 'chat') renderChat(id);
}
function renderChat(id) {
  const r = R[id];
  mMsgs.innerHTML = chatHist[id].map((m, i) => {
    if (m.who === 'agent') return `<div class="m-agent">${esc(m.text)}</div>`;
    if (m.who === 'user') return `<div class="m-user">${esc(m.text)}</div>`;
    if (m.who === 'work') return `<div class="m-work"><span class="wi">${m.i || '▸'}</span>${esc(m.text)}</div>`;
    if (m.who === 'file') return `
      <div class="m-file" data-i="${i}">
        <div class="f-head"><span>${m.icon}</span><div><div class="f-name">${esc(m.name)}</div><div class="f-meta">${esc(m.meta)}</div></div></div>
        <pre>${esc(m.content)}</pre>
      </div>`;
    if (m.who === 'appr') return `
      <div class="m-appr" data-i="${i}">
        <div class="a-who">needs your approval</div>
        <div class="a-ask">${esc(m.text)}</div>
        ${m.mock ? `<div class="a-mock">${m.mock}</div>` : ''}
        ${m.pending
          ? '<div class="a-btns"><button class="a-yes">APPROVE</button><button class="a-no">REJECT</button></div>'
          : `<div class="a-done">${m.approved ? '✓ Approved' : '✗ Rejected'} by AJ</div>`}
      </div>`;
    return '';
  }).join('');
  mMsgs.querySelectorAll('.m-file').forEach(el =>
    el.addEventListener('click', () => el.classList.toggle('exp')));
  mMsgs.querySelectorAll('.m-appr .a-yes').forEach(el =>
    el.addEventListener('click', () => resolveApproval(id, true)));
  mMsgs.querySelectorAll('.m-appr .a-no').forEach(el =>
    el.addEventListener('click', () => resolveApproval(id, false)));
  mMsgs.scrollTop = mMsgs.scrollHeight;
}
function renderActivity(id) {
  const r = R[id], v = r.v1;
  const task = rnd(v.tasks || ['Working through the queue'])
    .replace('{co}', rnd(P.co)).replace('{person}', person()).replace('{count}', ri(3, 9));
  document.getElementById('mNow').innerHTML = `NOW &nbsp;<b>${esc(task)}</b>`;
  document.getElementById('mStats').innerHTML = (v.stats || []).map(([l, val]) => `
    <div class="st"><div class="st-l">${esc(l)}</div><div class="st-v">${esc(String(typeof val === 'function' ? val() : val))}</div></div>`).join('');
  const chip = DEPTS[r.a.dept].chip;
  const mx = Math.max(...(v.chart || [1]));
  document.querySelector('#mChart .ch-lbl').textContent = v.chartLbl || '';
  document.querySelector('#mChart .ch-bars').innerHTML = (v.chart || []).map(n =>
    `<i style="height:${Math.round(n / mx * 100)}%;background:${chip}"></i>`).join('');
  document.getElementById('mFeed').innerHTML = r.feed.map(f => `
    <div class="fe"><span class="fi">${f.i}</span><span>${esc(f.text)}</span><span class="ft">${ago(f.ts)}</span></div>`).join('');
}
/* camera target offset so the pod sits beside the rail, not behind it */
function focusTarget(k, atPos) {
  const base = atPos ? [atPos.x, 0, atPos.z] : [LAYOUT[k].pos[0], 0, LAYOUT[k].pos[1] + 1];
  const boardW = (tasks ? tasks.panelWidth() : 400) + 30; // V3.3: the task panel is always on the right
  const zoom = atPos ? 3.3 : 2.5;
  const pxPerWorld = zoom * innerHeight / (2 * FR);
  const railW = Math.min(400, innerWidth * 0.92);
  // pod sits in the middle of whatever screen is left: rail on one side, board (if open) on the other
  const shift = ((railW - boardW) / 2 + (boardW ? 0 : 30)) / pxPerWorld;
  const dir = RAIL_SIDE[k] === 'left' ? -shift : shift;
  return { pos: [base[0] + SCREEN_RIGHT.x * dir, 0, base[2] + SCREEN_RIGHT.z * dir], zoom };
}
function enterFocus(k, pendingAgentId) {
  if (k === 'brain') { // the Brain keeps its plain fly-in (AJ's call)
    focused = 'brain';
    if (tasks) tasks.onFocusChange('brain');
    flyTo([LAYOUT.brain.pos[0], 0, LAYOUT.brain.pos[1] + 1.5], 3.1, 700);
    syncOverviewBtn();
    return;
  }
  if (focused === k && !pendingAgentId) return;
  if (focused && focused !== k) { rail.classList.remove('open', 'agentOpen'); modalOpen = null; }
  focused = k;
  if (tasks) tasks.onFocusChange(k);
  focusDimTarget = 1;
  applySceneDim(k);
  vignette.classList.add('on');
  const t = focusTarget(k);
  flyTo(t.pos, t.zoom, 950, {
    arc: RAIL_SIDE[k] === 'left' ? 0.10 : -0.10,
    onDone: () => { if (pendingAgentId) openAgentRail(pendingAgentId, pendingTab, true); pendingTab = 'chat'; },
  });
  buildDeptRail(k);
  rail.className = RAIL_SIDE[k];
  rail.style.display = 'block';
  // V3.4: the rail IS the chat — it opens on the department lead (or first agent) at once
  // (after the className reset above, which would otherwise drop the agentOpen state)
  const first = pendingAgentId || (AGENTS.find(x => x.dept === k && x.lead) || AGENTS.find(x => x.dept === k)).id;
  openAgentRail(first, pendingAgentId ? pendingTab : 'chat', false);
  document.getElementById('overviewBtn').classList.toggle('right', RAIL_SIDE[k] === 'left');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    rail.classList.add('open');
    flyBillboardIntoRail(k);
    cascadeRows();
  }));
  syncOverviewBtn();
}
function exitFocus(flyOut = true) {
  if (!focused) return;
  const k = focused;
  focused = null;
  modalOpen = null;
  if (tasks) tasks.onFocusChange(null);
  focusDimTarget = 0;
  vignette.classList.remove('on');
  rail.classList.remove('open', 'agentOpen');
  setTimeout(() => { if (!focused) rail.style.display = 'none'; }, 650);
  document.getElementById('overviewBtn').classList.remove('right');
  if (k !== 'brain' && deptRT[k] && deptRT[k].badge) deptRT[k].badge.style.display = '';
  if (flyOut) flyTo(overviewPos(), OVERVIEW.zoom, 700);
  syncOverviewBtn();
}
function buildDeptRail(k) {
  const dept = DEPTS[k];
  const n = AGENTS.filter(a => a.dept === k).length;
  const rh = document.getElementById('railHeader');
  rh.classList.remove('show');
  rh.innerHTML = `
    <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${dept.name}<span class="live"></span></div>
    <div class="b-count"><span class="b-num">${n}</span><span class="b-lab">AGENTS</span></div>
    <div class="b-metrics">${BB_ROWS[k].map((row, i) => `
      <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-rm="${k}-${i}">${row[1]()}</span></div>`).join('')}</div>
    ${tasks ? tasks.rowHTML(k) : ''}
    <div class="b-appr" style="display:${stuckIn(k).length ? 'flex' : 'none'}">⚠ <span class="ap-n">${stuckIn(k).length}</span> WAITING APPROVAL</div>`;
  const trow = rh.querySelector('.b-tasks');
  if (trow) trow.addEventListener('click', () => tasks.toggle());
  rh.querySelector('.b-appr').addEventListener('click', () => {
    const s = stuckIn(k)[0];
    if (s) openAgentRail(s.a.id);
  });
  // V3.7 (AJ, 6 Sep): the agent-chip strip is gone — click an agent in the scene to talk to them
}
function cascadeRows() {
  document.querySelectorAll('#railRows .arow').forEach((el, i) => {
    el.style.transitionDelay = (280 + i * 85) + 'ms';
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.style.transitionDelay = '0ms'; }, 1600);
  });
}
/* the floating billboard physically FLIES and docks as the rail header (the hero beat) */
function flyBillboardIntoRail(k) {
  const badge = deptRT[k].badge;
  const from = badge.getBoundingClientRect();
  badge.style.display = 'none';
  const side = RAIL_SIDE[k];
  const railW = rail.offsetWidth;
  const tLeft = side === 'left' ? 18 : innerWidth - railW + 18;
  const clone = badge.cloneNode(true);
  clone.style.cssText = `position:fixed;box-sizing:border-box;left:${from.left}px;top:${from.top}px;` +
    `width:${from.width}px;margin:0;transform:none;transition:all .72s var(--ease);z-index:40;pointer-events:none;opacity:1;`;
  document.body.appendChild(clone);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    clone.style.left = tLeft + 'px';
    clone.style.top = (52 + 18) + 'px';
    clone.style.width = (railW - 36) + 'px';
  }));
  setTimeout(() => {
    clone.remove();
    document.getElementById('railHeader').classList.add('show');
  }, 740);
}
function openAgentRail(id, tab = 'chat', fly = true) {
  const r = R[id];
  ensureChat(id);
  modalOpen = id;
  const dept = DEPTS[r.a.dept];
  document.querySelector('#railAgent .mh-dot').style.background = dept.chip;
  document.querySelector('#railAgent .mh-name').innerHTML =
    (r.a.lead ? '<span class="star">★ </span>' : '') + r.a.name;
  document.querySelector('#railAgent .mh-role').textContent = `${r.v1.role} · ${dept.name}`;
  document.querySelector('#railAgent .mh-tag').textContent = r.v1.tagline;
  document.getElementById('mChips').innerHTML = (r.v1.chips || []).map(c =>
    `<button>${esc(c)}</button>`).join('');
  document.getElementById('mChips').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => sendChat(b.textContent)));
  rail.classList.add('agentOpen');
  setTab(tab);
  if (fly) { const t = focusTarget(r.a.dept, r.seat); flyTo(t.pos, t.zoom, 500); }
}
// V3: the board opening/closing re-centres the pod without leaving focus
function reframe() {
  if (!focused || focused === 'brain' || modalOpen) return;
  const t = focusTarget(focused);
  flyTo(t.pos, t.zoom, 600);
}
function railBack() { // V3.4: "back" = back to the pod view, chat stays on the lead
  if (!focused || focused === 'brain') return;
  const lead = AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused);
  openAgentRail(lead.id, 'chat', false);
  const t = focusTarget(focused);
  flyTo(t.pos, t.zoom, 500);
}
document.getElementById('railBack').addEventListener('click', railBack);
let pendingTab = 'chat';
// compat entry point (person clicks, pills, CC export): route through focus mode
function openAgent(id, tab = 'chat') {
  const dept = R[id].a.dept;
  if (focused === dept) { openAgentRail(id, tab); return; }
  pendingTab = tab;
  enterFocus(dept, id);
}
function setTab(tab) {
  modalTab = tab;
  document.querySelectorAll('#rail .mtabs button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('mChat').style.display = tab === 'chat' ? 'flex' : 'none';
  document.getElementById('mAct').style.display = tab === 'activity' ? 'flex' : 'none';
  if (tab === 'chat') renderChat(modalOpen); else renderActivity(modalOpen);
}
document.querySelectorAll('#rail .mtabs button').forEach(b =>
  b.addEventListener('click', () => setTab(b.dataset.tab)));
function sendChat(text) {
  const id = modalOpen;
  if (!id || !text.trim()) return;
  const r = R[id];
  chatPush(id, { who: 'user', text });
  document.getElementById('mIn').value = '';
  const low = text.toLowerCase();
  setTimeout(() => {
    if (r.state === 'stuck' && /\b(approve|reject)\b/.test(low)) {
      resolveApproval(id, /approve/.test(low));
      return;
    }
    const rv = tasks && tasks.isLive() && text.match(/^\s*revise\s*[:\-–]\s*(.+)$/i); // LIVE: "revise: …" re-runs the last deliverable
    if (rv && tasks.revise(id, rv[1].trim())) { chatPush(id, { who: 'agent', text: 'On it — revising now. It will land here when it is ready.' }); return; }
    const tr = tasks && tasks.handleChat(id, text); // "add task: …" / "what's on the board"
    if (tr) { chatPush(id, { who: 'agent', text: tr }); return; }
    if (tasks && tasks.isLive()) { // LIVE: a real conversation with the agent, grounded in the brain
      chatPush(id, { who: 'work', i: '…', text: `${r.a.name} is thinking` });
      fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: id, text, history: chatHist[id].filter(m => m.who === 'user' || m.who === 'agent').slice(-8) }) })
        .then(async res => { if (!res.ok) throw new Error((await res.json()).error || res.statusText); return res.json(); })
        .then(j => {
          const h = chatHist[id]; const k = h.findIndex(m => m.who === 'work' && m.text === `${r.a.name} is thinking`); if (k >= 0) h.splice(k, 1);
          chatPush(id, { who: 'agent', text: j.reply });
          if (j.read) for (const n of j.read.slice(0, 2)) brain.readNote(id, n);
          if (j.tools && j.tools.length) mcp.onToolsUsed(id, j.tools);
        })
        .catch(e => chatPush(id, { who: 'agent', text: `I couldn't reach Claude (${e.message}).` }));
      return;
    }
    const hit = (r.v1.chat || []).find(c => c.k.some(k => low.includes(k)));
    const reply = hit ? rnd(hit.r) : rnd(r.v1.fallback || ['On it.']);
    chatPush(id, { who: 'agent', text: reply });
  }, 450 + Math.random() * 500);
}
document.getElementById('mSend').addEventListener('click', () =>
  sendChat(document.getElementById('mIn').value));
document.getElementById('mIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat(e.target.value);
  e.stopPropagation();
});
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
}

/* ---------- approval mockups — show AJ exactly what he's approving ---------- */
function mockupFor(id) {
  const chip = DEPTS[R[id].a.dept].chip;
  switch (id) {
    case 'apay': return `<div class="mk mk-doc">
      <div class="d-brand">INVOICE AUDIT — #218</div>
      <div class="d-title">Design contractor</div>
      <div class="d-line"><span>Invoiced</span><b>14 hrs × $110 = $1,540</b></div>
      <div class="d-line"><span>Contract rate</span><b>$85/hr (signed 12 Mar)</b></div>
      <div class="d-line"><span>Variance</span><b>+$350 ⚠</b></div>
      <div class="d-line"><span>Scope</span><b>matches the brief ✓</b></div>
      <div class="d-p">Hours and scope check out — only the rate is off, and there's no signed variation covering it. Recommend holding payment and querying the rate before it's paid.</div></div>`;
    case 'piper': return `<div class="mk mk-doc">
      <div class="d-brand">AGENTS OFFICE — PROPOSAL</div>
      <div class="d-title">Ridgeline Property Group</div>
      <div class="d-line"><span>Seats</span><b>12</b></div>
      <div class="d-line"><span>Plan</span><b>Growth</b></div>
      <div class="d-line"><span>Price</span><b>$1,080/mo · 12-mo lock</b></div>
      <div class="d-p">Proof point: Auckland roofing co — 0 → 40 tracked calls/week in 14 days. Sign-online link included.</div></div>`;
    case 'bill': return `<div class="mk mk-doc">
      <div class="d-brand">REFUND VERIFICATION</div>
      <div class="d-title">Harbour City Roofing — $680</div>
      <div class="d-line"><span>Reason</span><b>double payment, two cards</b></div>
      <div class="d-line"><span>Txn #1 / #2</span><b>verified ✓ / duplicate ✓</b></div>
      <div class="d-line"><span>Account</span><b>14 months, good standing</b></div>
      <div class="d-p">Legit case. Above my $500 limit — releases the moment you approve.</div></div>`;
    case 'iggy': return `<div class="mk-phone">
      <div class="ph-handle"></div>
      <div class="ph-hook">“calls before 10am are a trap”</div>
      <div class="ph-sub">connect rates nearly double 10:00–11:30am — across 40,000 dials</div>
      <div class="ph-ui"><span>♥ 2.4k</span><span>💬 118</span><span>↗ share</span></div></div>`;
    case 'ada': return `<div class="mk mk-ad">
      <div class="ad-head"><div class="ad-av"></div><div><div class="ad-who">sahni.ai</div><div class="ad-sp">Sponsored</div></div></div>
      <div class="ad-text">Cold call anxiety? Your first 5 dials decide your whole day…</div>
      <div class="ad-media" style="background:linear-gradient(135deg, ${chip}55, ${chip}22)">“the 10am rule — call when they answer”</div>
      <div class="ad-foot"><span class="ad-hl">Start your free trial</span><span class="ad-cta">SIGN UP</span></div>
      <div class="ad-stat">CPA $29 · best performer · scaling to $180/day</div></div>`;
    case 'newt': return `<div class="mk mk-mail">
      <div class="ml-lab">SUBJECT A</div><div class="ml-sub">calls before 10am are a trap</div>
      <div class="ml-lab">SUBJECT B</div><div class="ml-sub">we looked at 40,000 calls — call at this time</div>
      <div class="ml-body">  before 10am ...... 11% connect
  10:00–11:30 ...... 21% connect
  after 4pm ........ 9% connect

→ 3,400 subscribers · CTA: reply "10AM"</div></div>`;
    case 'scout': return `<div class="mk mk-doc">
      <div class="d-brand">OPPORTUNITY MEMO</div>
      <div class="d-title">CallForge +8% price rise</div>
      <div class="d-line"><span>Window</span><b>2–3 weeks</b></div>
      <div class="d-line"><span>Play</span><b>comparison page + retargeting</b></div>
      <div class="d-line"><span>Briefed</span><b>META ADS · PROPOSALS</b></div>
      <div class="d-p">Their G2 reviews already flag value-for-money. Talk-track: 12-month price lock.</div></div>`;
    case 'enzo': return `<div class="mk mk-doc">
      <div class="d-brand">PURCHASE ORDER</div>
      <div class="d-title">FullEnrich — 500 credits</div>
      <div class="d-line"><span>Cost</span><b>$250 ($0.50/credit)</b></div>
      <div class="d-line"><span>Current balance</span><b>38 credits — out tomorrow</b></div>
      <div class="d-line"><span>Burn rate</span><b>~90/week</b></div>
      <div class="d-p">Same card as last month. Without credits, enrichment stops and the Sales Lead runs dry.</div></div>`;
    default: {
      // generic: render the agent's own deliverable in a document frame
      if (!FILE_GEN[id]) return '';
      const f = FILE_GEN[id]();
      return `<div class="mk mk-doc">
        <div class="d-brand">${esc(f.name)}</div>
        <div class="ml-body" style="border:0;margin:0;padding:6px 0 0">${esc(f.content.split('\n').slice(0, 9).join('\n'))}</div></div>`;
    }
  }
}

/* ---------- approvals: agent STUCK → amber billboard row → chat approval message ---------- */
function requestApproval(id) {
  const r = R[id];
  if (!r || r.state !== 'working') return;
  r.state = 'stuck';
  r.ask = APPROVAL_BY_AGENT[id] || sample(APPROVAL_ASKS[r.a.dept], 1)[0];
  r.warn.visible = true;
  const hadChat = !!chatHist[id]; // fresh chats already seed the deliverable card
  chatPush(id, { who: 'appr', text: r.ask, pending: true, mock: mockupFor(id) });
  if (FILE_GEN[id] && hadChat) chatPush(id, { who: 'file', ...FILE_GEN[id]() });
  if (tasks) tasks.onStuck(id, r.ask);
  syncApprovals();
}
function resolveApproval(id, approved) {
  const r = R[id];
  if (!r || r.state !== 'stuck') return;
  r.state = 'working';
  r.ask = null;
  r.warn.visible = false;
  const msg = chatHist[id] && [...chatHist[id]].reverse().find(m => m.who === 'appr' && m.pending);
  if (msg) { msg.pending = false; msg.approved = approved; }
  // visible reaction in the scene: cheer + ✅, or slump + ❌
  const now = performance.now();
  if (approved) r.cheerUntil = now + 2400; else r.slumpUntil = now + 2600;
  spawnEmote(r, approved ? '✅' : '❌');
  if (tasks) tasks.onResolve(id, approved);
  chatPush(id, {
    who: 'agent',
    text: approved ? '✓ Approved — actioning it now. I\'ll log the result in my activity.'
                   : '✗ Understood — parked. I\'ll adjust and come back with a better version.',
  });
  syncApprovals();
}
function stuckIn(dept) { return Object.values(R).filter(r => r.state === 'stuck' && r.a.dept === dept); }
function syncApprovals() {
  let total = 0;
  for (const k of DEPT_KEYS) {
    const n = stuckIn(k).length; total += n;
    deptRT[k].apprRow.style.display = n ? 'flex' : 'none';
    deptRT[k].apprN.textContent = n;
  }
  const top = document.getElementById('topAppr');
  top.style.display = total ? 'inline-flex' : 'none';
  top.querySelector('span').textContent = total;
  // mirror into the docked rail header + row status tags
  if (focused && focused !== 'brain') {
    const n = stuckIn(focused).length;
    const rh = document.getElementById('railHeader');
    const ap = rh.querySelector('.b-appr');
    if (ap) { ap.style.display = n ? 'flex' : 'none'; ap.querySelector('.ap-n').textContent = n; }
  }
}
function zoomToApproval(dept) {
  const s = stuckIn(dept)[0];
  if (!s) { enterFocus(dept); return; }
  if (focused === dept) openAgentRail(s.a.id);
  else enterFocus(dept, s.a.id);
}
document.getElementById('topAppr').addEventListener('click', () => {
  const s = Object.values(R).find(r => r.state === 'stuck');
  if (s) zoomToApproval(s.a.dept);
});

/* ---------- event engine: weighted v1 templates → feed + chat + billboards ---------- */
function weightedEv(evs) {
  const tot = evs.reduce((s, e) => s + (e.p || 1), 0);
  let x = Math.random() * tot;
  for (const e of evs) { x -= (e.p || 1); if (x <= 0) return e; }
  return evs[0];
}
function fireAgentEvent(seedTs) {
  const ids = Object.keys(R).filter(id => R[id].v1 && R[id].v1.ev && R[id].state !== 'stuck');
  const r = R[ids[Math.floor(Math.random() * ids.length)]];
  const ev = weightedEv(r.v1.ev);
  const text = ev.t();
  r.feed.unshift({ i: ev.i, text, ts: seedTs || Date.now() });
  if (r.feed.length > 30) r.feed.pop();
  if (!seedTs) {
    spawnEmote(r, ev.i); // real work events pop their icon over the desk
    mcp.onAgentEvent(r.a.id, r.a.dept, r.seat, performance.now()); // tool tile pulses + packet beam
    if (focused === r.a.dept) { // live-update the rail activity row
      const line = document.querySelector(`[data-line="${r.a.id}"]`);
      if (line) line.textContent = ev.i + ' ' + text;
    }
    if (chatHist[r.a.id]) chatPush(r.a.id, { who: 'work', i: ev.i, text });
    if (ev.kpi) { const k = KPIS.find(x => x.id === ev.kpi.id); if (k) k.val += ev.kpi.n; }
    const d = r.a.dept, roll = Math.random();
    if (d === 'emails') { if (roll < 0.45) STATS.emailsSent++; else if (roll < 0.7) STATS.drafts++; }
    else if (d === 'delivery' && roll < 0.2) STATS.reports++;
    else if (d === 'sales') {
      if (roll < 0.4) STATS[rnd(['spencer', 'arwin', 'jack'])]++;
      else if (roll < 0.5) STATS.autoOnb++;
      else if (roll < 0.56) STATS.managers++;
    }
    else if (d === 'marketing') {
      if (roll < 0.18) STATS.insMkt++;
      else if (roll < 0.5) STATS.cpa = Math.max(25, STATS.cpa + (Math.random() - 0.55) * 1.2);
    }
    else if (d === 'ops' && roll < 0.22) STATS.insOps++;
    else if (d === 'fin' && roll < 0.3) STATS.billsPaid++;
    if (ev.brain || Math.random() < 0.12) { brainNotes++; brain.read(r.a.id); } // the Brain shows the read
    updateBillboards();
    if (modalOpen === r.a.id && modalTab === 'activity') renderActivity(r.a.id);
  }
}
// seed a believable history so Activity isn't empty at boot
for (let i = 0; i < 170; i++) fireAgentEvent(Date.now() - ri(2, 200) * 60000);
for (const r of Object.values(R)) r.feed.sort((a, b) => b.ts - a.ts);

/* ---------- minimal sim: work bobs, screen updates, brain meetings ---------- */
let meeting = null; // Brain meetings fire ONLY on the X hotkey (AJ's call — demo cue, not ambient)
let nextApprovalAt = performance.now() + 20000;
let nextMetricAt = performance.now() + 3000;
let nextEmoteAt = performance.now() + 2000;

function planMeeting(now) {
  const ids = Object.keys(R).filter(id => R[id].state === 'working');
  const a = R[ids[Math.floor(Math.random() * ids.length)]];
  let b = a;
  while (b.a.dept === a.a.dept) b = R[ids[Math.floor(Math.random() * ids.length)]];
  for (const [i, r] of [a, b].entries()) {
    const d = deptRT[r.a.dept];
    const stand = new THREE.Vector3(2 + (i ? 3.4 : -3.4), 0.12, 2 + 2.6);
    r.path = [r.seat.clone(), d.gate.clone().setY(0.12), d.brainGate.clone().setY(0.12), stand];
    r.pathI = 0; r.state = 'walking';
  }
  meeting = { a, b, phase: 'gather', endAt: 0 };
}

function walkStep(r, dt) {
  const cur = r.person.position, tgt = r.path[r.pathI];
  const d = new THREE.Vector3().subVectors(tgt, cur); d.y = 0;
  const dist = d.length();
  const step = r.speed * dt;
  if (dist <= step) {
    cur.copy(tgt);
    r.pathI++;
    if (r.pathI >= r.path.length) return true;
  } else {
    d.normalize();
    cur.addScaledVector(d, step);
    r.person.rotation.y = Math.atan2(d.x, d.z);
  }
  return false;
}

// desk-life variety: each agent cycles through work modes on its own clock
// no 'stretch' — AJ found the stand-up stretches annoying (1 Aug). Last entry = pick fallback.
const WORK_MODES = [
  ['type', 0.30, 4000, 7500], ['read', 0.18, 3500, 6500], ['phone', 0.16, 4000, 8000],
  ['glance', 0.17, 2000, 3500], ['sip', 0.11, 2500, 4000], ['spin', 0.08, 1400, 2000],
];
function pickWorkMode(r, now) {
  let x = Math.random();
  for (const [mode, w, dMin, dMax] of WORK_MODES) {
    x -= w;
    if (x <= 0 || mode === WORK_MODES[WORK_MODES.length - 1][0]) {
      r.workMode = mode;
      r.modeStart = now;
      r.modeUntil = now + dMin + Math.random() * (dMax - dMin);
      if (mode === 'glance')
        r.person.userData.glanceDir = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.25);
      return;
    }
  }
}
// standing modes drift the agent from the chair to a spot beside the desk, and can re-face the camera
const FACE_CAM = Math.PI / 4;
function applyStandAndFacing(r, mode, now, dt) {
  const u = r.person.userData;
  const sk = (u.cur && u.cur.standK) || 0;
  r.person.position.x = r.seat.x + (r.stand.x - r.seat.x) * sk;
  r.person.position.z = r.seat.z + (r.stand.z - r.seat.z) * sk;
  if (mode === 'spin') {
    const span = Math.max(400, (r.modeUntil - r.modeStart) || 1500);
    r.person.rotation.y = r.seatRot + ((now - r.modeStart) / span) * Math.PI * 2;
    return;
  }
  const target = (mode === 'stretch' || mode === 'cheer' || mode === 'wave') ? FACE_CAM : r.seatRot;
  let d = target - r.person.rotation.y;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  r.person.rotation.y += d * (1 - Math.exp(-dt * 6));
}
// floating emoji work-bubbles — constant visible "something is happening" at any zoom
const emoteTex = {};
function getEmoteTex(icon) {
  if (!emoteTex[icon]) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    // cream bubble disc so the icon reads at any zoom
    x.beginPath(); x.arc(64, 60, 52, 0, 7);
    x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
    x.lineWidth = 3; x.strokeStyle = 'rgba(21,20,20,0.25)'; x.stroke();
    x.beginPath(); x.moveTo(50, 106); x.lineTo(64, 124); x.lineTo(74, 104); x.closePath();
    x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
    x.font = '58px "Apple Color Emoji", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#151414';
    x.fillText(icon, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    emoteTex[icon] = t;
  }
  return emoteTex[icon];
}
const emotes = [];
function spawnEmote(r, icon) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getEmoteTex(icon), depthTest: false, transparent: true }));
  const p = r.person.position;
  s.position.set(p.x + 0.7, p.y + 5.6, p.z);
  s.scale.set(2.9, 2.9, 1);
  scene.add(s);
  emotes.push({ s, born: performance.now() });
}
function tickEmotes(now, dt) {
  for (let i = emotes.length - 1; i >= 0; i--) {
    const e = emotes[i], age = (now - e.born) / 1700;
    if (age >= 1) {
      scene.remove(e.s); e.s.material.dispose(); emotes.splice(i, 1);
    } else {
      e.s.position.y += dt * 1.7;
      e.s.material.opacity = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85;
    }
  }
}
function tickSim(now, dt) {
  for (const r of Object.values(R)) {
    if (r.state === 'working') {
      let mode;
      if (r.cheerUntil && now < r.cheerUntil) mode = 'cheer';
      else if (r.slumpUntil && now < r.slumpUntil) mode = 'slump';
      else {
        if (!r.modeUntil) { // first pick: desync everyone so the room never moves in lockstep
          pickWorkMode(r, now);
          r.modeUntil = now + 400 + Math.random() * 4000;
        } else if (now > r.modeUntil) pickWorkMode(r, now);
        mode = r.workMode;
      }
      poseWork(r.person, mode, now + r.bob * 500, dt);
      applyStandAndFacing(r, mode, now, dt);
    } else if (r.state === 'walking' || r.state === 'returning') {
      posePerson(r.person, 'walk', now);
      if (walkStep(r, dt)) {
        if (r.state === 'walking') {
          r.state = 'atBrain';
          r.person.rotation.y = r.person.position.x < 2 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          r.state = 'working';
          r.person.position.copy(r.seat);
          r.person.rotation.y = r.seatRot;
        }
      }
    } else if (r.state === 'atBrain') {
      posePerson(r.person, 'stand', now);
    }
  }
  if (meeting) {
    const { a, b } = meeting;
    if (meeting.phase === 'gather' && a.state === 'atBrain' && b.state === 'atBrain') {
      meeting.phase = 'talk';
      meeting.endAt = now + 8000 + Math.random() * 6000;
      bubble.visible = true;
    }
    if (meeting.phase === 'talk') {
      bubble.scale.setScalar(4 + Math.sin(now / 300) * 0.3);
      if (now > meeting.endAt) {
        bubble.visible = false;
        for (const r of [a, b]) {
          r.path = [...r.path].reverse(); r.path[r.path.length - 1] = r.seat.clone();
          r.pathI = 0; r.state = 'returning';
        }
        meeting = null;
      }
    }
  }
  // stuck agents STAND, face the camera and WAVE under their pulsing ⚠ (AJ's spec)
  for (const r of Object.values(R)) {
    if (r.state === 'stuck') {
      poseWork(r.person, 'wave', now + r.bob * 500, dt);
      applyStandAndFacing(r, 'wave', now, dt);
      const p = r.person.position;
      r.warn.position.set(p.x, p.y + 5.9, p.z);
      const k = 2.6 + Math.sin(now / 240) * 0.5;
      r.warn.scale.set(k, k, 1);
    }
  }
  // ambient emoji work-bubbles pop over random desks every beat or two
  if (now > nextEmoteAt) {
    const ids = Object.keys(R).filter(id => R[id].state === 'working');
    if (ids.length) spawnEmote(R[ids[Math.floor(Math.random() * ids.length)]],
      rnd(['💬', '✉️', '📈', '💡', '✓', '📞', '🔍', '📎']));
    nextEmoteAt = now + 1200 + Math.random() * 1800;
  }
  tickEmotes(now, dt);
  tickSweep(now);
  brain.tick(now);
  // schedule a new approval request now and then — capped so a long unattended demo
  // never ends up with half the office stuck waving (v1 demo-safety rule)
  if (now > nextApprovalAt) {
    const pending = Object.values(R).filter(r => r.state === 'stuck').length;
    if (pending < 2) {
      const ids = Object.keys(R).filter(id => R[id].state === 'working' && !R[id].a.lead);
      if (ids.length) requestApproval(ids[Math.floor(Math.random() * ids.length)]);
    }
    nextApprovalAt = now + 50000 + Math.random() * 40000;
  }
  // agent events drive everything — feed, chat streams, billboard metrics (nothing is static)
  if (now > nextMetricAt) {
    fireAgentEvent();
    nextMetricAt = now + 2600 + Math.random() * 3800;
  }
  // rotate desk screen content — a couple of screens refresh every beat so the room reads busy
  if (Math.floor(now / 1800) !== Math.floor((now - dt * 1000) / 1800)) {
    const n = 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const ss = screenSets[Math.floor(Math.random() * screenSets.length)];
      ss.screenSet.draw(sample(WORKLINES[ss.dept], 3).map(l => l.slice(0, 28)));
      ss.screenSet.tex.needsUpdate = true;
    }
  }
}

/* ---------- zoom LOD + HTML overlay projection ---------- */
const v3 = new THREE.Vector3();
function toScreen(p) {
  v3.copy(p).project(camera);
  return [(v3.x * 0.5 + 0.5) * innerWidth, (-v3.y * 0.5 + 0.5) * innerHeight];
}
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

function tickLOD() {
  const z = view.zoom;
  const detail = smooth(1.75, 2.5, z);
  const pillA = smooth(1.45, 1.85, z); // pills stay on at near — they name the agents
  // billboards persist at every zoom (v1 rule) — slightly larger when far, compact when near
  const badgeScale = 1.02 - 0.3 * smooth(1.2, 2.6, z);
  for (const [k, d] of Object.entries(deptRT)) {
    if (focused === k && k !== 'brain') continue; // this billboard is docked in the rail
    let [sx, sy] = toScreen(d.badgeAnchor);
    // keep billboards fully on screen (camera-readability rule)
    const bh = d.badge.offsetHeight * badgeScale, bw = d.badge.offsetWidth * badgeScale;
    let xf;
    if (d.sideBadge) { // anchored by an edge, vertically centred (emails/sales/fin/delivery)
      const rightEdge = innerWidth - ((tasks ? tasks.panelWidth() : 400) + 26); // V3.3: never under the panel
      sy = clamp(sy, 64 + bh / 2, innerHeight - bh / 2 - 8);
      if (d.sideLeft) { sx = clamp(sx, bw + 8, rightEdge); xf = 'translate(-100%,-50%)'; }
      else { sx = clamp(sx, 8, rightEdge - bw); xf = 'translate(0,-50%)'; }
    } else {
      const rightEdge = innerWidth - ((tasks ? tasks.panelWidth() : 400) + 26);
      sy = clamp(sy, bh + 64, innerHeight - 12);
      sx = clamp(sx, bw / 2 + 8, rightEdge - bw / 2);
      xf = 'translate(-50%,-100%)';
    }
    d.badge.style.transform = `translate(${sx}px,${sy}px) ${xf} scale(${badgeScale})`;
    d.badge.style.opacity = 1 - 0.75 * focusDim; // unfocused boards recede with the scene
    d.badge.style.pointerEvents = 'auto';
  }
  // name pills stay on at EVERY zoom (AJ's call) — smaller when far, full-size when near
  const pillScale = 0.62 + 0.38 * smooth(1.2, 2.4, z);
  for (const r of Object.values(R)) {
    const p = r.person.position;
    const [sx, sy] = toScreen(v3.set(p.x, p.y + 5.9 * (r.a.lead ? 1.12 : 1), p.z).clone());
    r.pill.style.display = 'block';
    r.pill.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-100%) scale(${pillScale})`;
    const dimmed = focused && focused !== 'brain' && r.a.dept !== focused;
    r.pill.style.opacity = dimmed ? 1 - 0.85 * focusDim : 1;
  }
}

/* ---------- clock (REAL local time — locked rule) ---------- */
function tickClock() {
  const d = new Date();
  document.getElementById('clock').textContent =
    d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(tickClock, 1000); tickClock();

/* ---------- helpers ---------- */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function sample(arr, n) {
  const out = [...arr].sort(() => Math.random() - 0.5).slice(0, n);
  return out;
}

/* ---------- V3 task boards ---------- */
function feedPush(r, i, text) {
  r.feed.unshift({ i, text, ts: Date.now() });
  if (r.feed.length > 30) r.feed.pop();
  if (focused === r.a.dept) {
    const line = document.querySelector(`[data-line="${r.a.id}"]`);
    if (line) line.textContent = i + ' ' + text;
  }
  if (modalOpen === r.a.id && modalTab === 'activity') renderActivity(r.a.id);
}
// V3.1 LIVE: the served roster (office.agents.json) renames the seats and rewrites what each
// agent says about itself; the demo's fake greetings and stat chips are wrong in a real office
function applyRoster(agents) {
  if (!Array.isArray(agents)) return;
  for (const a of agents) {
    const r = R[a.id]; if (!r) continue;
    r.a.name = a.name;
    r.pill.innerHTML = (r.a.lead ? '<span class="star">★</span>' : '') + esc(a.name);
    r.v1 = r.v1 || {};
    r.v1.role = a.role || r.v1.role || ''; r.v1.tagline = a.does || r.v1.tagline || '';
    r.v1.greeting = `${a.does || 'I am ' + a.name + '.'} Give me a task in the bar on the right, or ask me something here.` +
      (a.interviewer && a.setUp === false ? ` Nothing in this department is yours yet: say "set up" and I will ask you five questions about how it works here, then write it down for the team.` : '');
    r.v1.chips = a.interviewer && a.setUp === false ? ['set up', 'What can you do for me?', 'What tools can you use?'] : ['What are you working on?', 'What can you do for me?', 'What tools can you use?'];
    if (chatHist[a.id] && chatHist[a.id][0] && chatHist[a.id][0].who === 'agent') chatHist[a.id][0].text = r.v1.greeting;
    if (modalOpen === a.id) openAgentRail(a.id, modalTab, false);
  }
}
tasks = initTasks({
  hud, R, deptRT, RAIL_SIDE, spawnEmote, chatPush, chatHist, feedPush, zoomToApproval, enterFocus, openAgent, esc,
  brainWrite: (id, title) => brain.write(id, title), brain,
  onLive: (h) => { document.querySelector('#topbar .brand .ver').textContent = 'BETA'; document.title = `${h.name} — Agents Office`; brain.setOwner(h.name); applyRoster(h.agents); },
  onTools: (agentId, keys) => mcp.onToolsUsed(agentId, keys),
  getFocused: () => focused, getZoom: () => view.zoom, getFocusDim: () => focusDim,
  toScreen: (p) => toScreen(p), reframe,
});
view.target.set(...overviewPos());
addEventListener('resize', () => { if (!focused && !tween) view.target.set(...overviewPos()); });

/* ---------- boot ---------- */
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  applyCamera();
}
addEventListener('resize', resize);
resize();

// deterministic view hooks for headless screenshots: #view=sales | #zoom=2.2
{
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('zoom')) view.zoom = parseFloat(h.get('zoom')) || 1;
  if (h.get('appr')) requestApproval(h.get('appr') === '1' ? 'apay' : h.get('appr'));
  if (h.get('view') && LAYOUT[h.get('view')]) enterFocus(h.get('view'));
  if (h.get('cam')) setCam(h.get('cam') === '1');
  if (h.get('dark') === '1' || document.body.classList.contains('dark')) setDark(true);
  if (h.get('board')) { // #board=1 → company board · #board=marketing → that dept's board
    const b = h.get('board');
    if (LAYOUT[b] && b !== 'brain') tasks.openFor(b); else tasks.open();
  }
  syncOverviewBtn();
}
window.CC = { flyTo, zoomToDept, zoomOut, zoomToApproval, requestApproval, openAgent, view, applyCamera, R, emotes,
  setCam, setDark, brain, connectorReveal: () => mcp.startReveal(performance.now()),
  toggleBoard: () => tasks.toggle(), addTask: (agentId, title) => tasks.addTask(agentId, title), tasks };

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  tickTween(now);
  applyCamera();
  tickDim(dt);
  tickSim(now, dt);
  tickLOD();
  tasks.tick(now);
  mcp.tick(now, dt, view, camera, focused, focusDim);
  syncOverviewBtn();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
