// Command Centre — Three.js isometric office over the LIVE daemon. Real data only:
// every badge, pill, chat line and desk state comes from /api/office, /api/agents
// and the /api/events SSE stream. No simulator, no invented events.
import * as THREE from 'three';
import { TOKENS, BRAIN, computeLayout, DESK_GRID, appearanceFor } from './data.js';
import {
  PLINTH_H, mat, rbox, makePlinth, makeDesk, makeChair,
  makePerson, posePerson, poseWork, makePlant, makeWalkway, makeWarnSprite,
  makeNeuralBrain,
} from './builders.js';

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
const view = { target: new THREE.Vector3(0, 0, 2), zoom: 1, arc: 0 };
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
scene.add(new THREE.HemisphereLight(0xfdfff8, 0xd8d4c8, 0.85));
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

/* ---------- office state (all real) ---------- */
const hud = document.getElementById('hud');
let OFFICE = null;          // GET /api/office
let DEPTS = {};             // key -> { key, name, chip, ink, floor, agents:[{id,hired}] }
let DEPT_ORDER = [];        // config order — hotkeys 1..6, pod slots
let LAYOUT = {};
let hasBrain = false;
const R = {};               // runtime per config agent id (hired AND vacant)
const deptRT = {};          // runtime per dept key
const clickTargets = [];
const personTargets = [];
let brainNet = null;
let LIVE_FROM = Infinity;   // events with ts >= LIVE_FROM are live (v1 bridge rule)
const APPROVALS = [];       // [{id, agentId, summary, files}]
let HOME = [0, 0, 2];       // overview target — pod centroid (origin only when the brain sits there)

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'now' : m < 60 ? m + 'm ago' : m < 60 * 24 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago';
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* ---------- boot: fetch the real office, then build the scene ---------- */
async function boot() {
  let agents = [];
  try {
    OFFICE = await (await fetch('/api/office')).json();
    agents = (await (await fetch('/api/agents')).json()).agents ?? [];
  } catch (err) {
    showEmpty('CAN\'T REACH THE DAEMON', 'Start it with <b>office start</b>, then reload.');
    return;
  }
  hasBrain = !!OFFICE.brain;
  DEPT_ORDER = (OFFICE.departments ?? []).map(d => d.key);
  for (const d of OFFICE.departments ?? []) {
    DEPTS[d.key] = { key: d.key, name: d.name.toUpperCase(), chip: d.colours.chip, ink: d.colours.ink, floor: d.colours.floor, agents: d.agents };
  }
  if (!DEPT_ORDER.length) {
    showEmpty('AN EMPTY OFFICE', 'Add departments + agents to <b>office.config.json</b> (see office.config.example.json), then reload.');
  }
  LAYOUT = computeLayout(OFFICE.departments ?? [], hasBrain);
  if (DEPT_ORDER.length) {
    const xs = DEPT_ORDER.map(k => LAYOUT[k].pos[0]), zs = DEPT_ORDER.map(k => LAYOUT[k].pos[1]);
    if (hasBrain) { xs.push(0); zs.push(0); }
    HOME = [xs.reduce((a, b) => a + b, 0) / xs.length, 0, zs.reduce((a, b) => a + b, 0) / zs.length + 2];
    view.target.set(HOME[0], HOME[1], HOME[2]);
  }
  buildScene();
  const byId = Object.fromEntries(agents.map(a => [a.id, a]));
  for (const [id, r] of Object.entries(R)) {
    if (!r.hired) continue;
    const a = byId[id];
    if (a) applySummary(id, a);
  }
  syncTopTag();
  syncWarnings();
  connectEvents();
  applyHashHooks();
  setInterval(pollAgents, 20_000);
  setInterval(() => { updateBillboards(); }, 30_000); // relative "last activity" stays fresh
}

function showEmpty(title, sub) {
  const el = document.getElementById('empty');
  el.style.display = 'flex';
  el.querySelector('.e-title').textContent = title;
  el.querySelector('.e-sub').innerHTML = sub;
}

async function pollAgents() {
  try {
    const { agents } = await (await fetch('/api/agents')).json();
    for (const a of agents) if (R[a.id]?.hired) applySummary(a.id, a, { quiet: true });
    updateBillboards();
  } catch { /* daemon briefly away — SSE reconnect handles recovery */ }
}

function applySummary(id, a, { quiet = false } = {}) {
  const r = R[id];
  r.summary = a;
  r.totals = a.totals ?? {};
  const pend = a.pending_approvals ?? [];
  for (const p of pend) {
    if (!APPROVALS.some(x => x.id === p.id)) {
      APPROVALS.push({ id: p.id, agentId: id, summary: p.summary, files: p.files ?? [] });
      chatPush(id, { who: 'appr', apId: p.id, text: p.summary, files: p.files ?? [], resolved: null }, { silent: quiet });
    }
  }
  setAgentState(id, pend.length ? 'stuck' : a.status === 'running' ? 'running' : 'idle');
  syncApprovals();
}

/* ---------- build the scene from config ---------- */
function buildScene() {
  for (const k of DEPT_ORDER) {
    const dept = DEPTS[k];
    const L = LAYOUT[k];
    const g = new THREE.Group();
    g.position.set(L.pos[0], 0, L.pos[1]);
    const plinth = makePlinth(L.w, L.d, dept.floor);
    g.add(plinth);
    plinth.traverse(o => { if (o.isMesh) { o.userData.dept = k; clickTargets.push(o); } });
    scene.add(g);
    deptRT[k] = { group: g, L };

    // plant on the outer corner
    const sx = Math.sign(L.pos[0]) || 1, sz = Math.sign(L.pos[1]) || 1;
    const p = makePlant();
    p.position.set(L.pos[0] + sx * (L.w / 2 - 1.6), 0.12, L.pos[1] + sz * (L.d / 2 - 1.6));
    p.traverse(o => { if (o.isMesh) o.userData.dept = k; });
    scene.add(p);
  }

  if (hasBrain) {
    const L = LAYOUT.brain;
    const g = new THREE.Group();
    g.position.set(L.pos[0], 0, L.pos[1]);
    const plinth = makePlinth(L.w, L.d, BRAIN.floor);
    g.add(plinth);
    plinth.traverse(o => { if (o.isMesh) { o.userData.dept = 'brain'; clickTargets.push(o); } });
    scene.add(g);
    deptRT.brain = { group: g, L };
    brainNet = makeNeuralBrain();
    brainNet.group.position.set(0, 8.4, 0);
    g.add(brainNet.group);
    brainNet.group.traverse(o => { if (o.isMesh || o.isLine || o.isSprite) o.userData.dept = 'brainCore'; });
    const plant = makePlant(); plant.position.set(6.2, 0.12, -5.8); g.add(plant);
    deptRT.brain.group.traverse(o => { if ((o.isMesh || o.isSprite) && !o.userData.dept) o.userData.dept = 'brain'; });

    // walkways dept -> brain (pod inner edge to the brain's edge)
    for (const k of DEPT_ORDER) {
      const dl = LAYOUT[k];
      const dir = new THREE.Vector2(dl.pos[0], dl.pos[1]).normalize(); // brain → pod
      const from = [dl.pos[0] - dir.x * (dl.w / 2 - 1), dl.pos[1] - dir.y * (dl.d / 2 - 1)];
      const to = [dir.x * 6.5, dir.y * 6.5];
      const walk = makeWalkway(from, to);
      walk.userData.dept = k;
      scene.add(walk);
    }
  }

  /* desks + people: every pod carries 4 stations; config agents fill slots in
     order, hired ones get a person, the rest read as vacant desks (growth). */
  const ANG = Math.PI / 4; // stations rotated so monitors face the camera
  for (const k of DEPT_ORDER) {
    const dept = DEPTS[k];
    const L = LAYOUT[k];
    for (let slot = 0; slot < 4; slot++) {
      const [col, row] = DESK_GRID[slot];
      const gx = (col - 0.5) * 8.6;
      const gz = (row - 0.5) * 6.4 - 1;
      const base = new THREE.Vector3(L.pos[0] + gx, 0.12, L.pos[1] + gz);
      const rot = (v) => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), ANG);

      const station = new THREE.Group();
      station.position.copy(base);
      station.rotation.y = ANG;
      const { group: desk, screenSet } = makeDesk(dept.chip);
      station.add(desk);
      const chair = makeChair();
      chair.position.set(0, 0, 1.75);
      station.add(chair);
      station.traverse(o => { if (o.isMesh) o.userData.dept = k; });
      scene.add(station);

      const entry = dept.agents[slot]; // {id, hired} or undefined (open desk)
      if (!entry) { drawScreen(screenSet, null, dept.chip, 'open'); continue; }

      const id = entry.id;
      const pill = document.createElement('div');
      pill.className = 'pill' + (entry.hired ? '' : ' vacant');
      const lead = slot === 0; // first-listed agent carries the dept (taller, gold pin)
      pill.innerHTML = (lead && entry.hired ? '<span class="star">★</span>' : '') + esc(id.toUpperCase()) + (entry.hired ? '' : ' · VACANT');
      hud.appendChild(pill);

      let person = null;
      if (entry.hired) {
        const look = appearanceFor(id);
        person = makePerson({ hair: look.hair, skin: look.skin, chip: dept.chip, lead });
        person.position.copy(base).add(rot(new THREE.Vector3(0, 0, 1.7)));
        person.rotation.y = ANG + Math.PI;
        person.traverse(o => { if (o.isMesh) { o.userData.agentId = id; o.userData.dept = k; personTargets.push(o); } });
        scene.add(person);
        pill.addEventListener('click', () => openAgent(id, 'chat'));
        drawScreen(screenSet, [], dept.chip, 'idle');
      } else {
        pill.classList.add('hireable');
        pill.addEventListener('click', () => openHire(id, k));
        drawScreen(screenSet, null, dept.chip, 'vacant');
      }

      const warn = makeWarnSprite();
      warn.visible = false;
      scene.add(warn);

      R[id] = {
        id, dept: k, lead, hired: entry.hired, person, warn, pill, screenSet,
        seat: person ? person.position.clone() : base.clone(),
        seatRot: ANG + Math.PI,
        stand: person ? person.position.clone().add(rot(new THREE.Vector3(1.5, 0, 0.15))) : base.clone(),
        state: 'idle', bob: Math.random() * 10,
        feed: [], screenLines: [], totals: {}, summary: null, lastEventTs: 0,
      };
    }
  }

  buildBillboards();
  document.getElementById('tag').style.display = '';
}

// desk screens carry REAL work lines (the last few events), or an honest empty state
function drawScreen(screenSet, lines, chip, kind) {
  const x = screenSet.ctx;
  x.fillStyle = '#FDFFF8'; x.fillRect(0, 0, 256, 160);
  if (kind === 'vacant' || kind === 'open') {
    x.fillStyle = 'rgba(21,20,20,.24)'; x.font = 'bold 15px Menlo, monospace';
    x.fillText(kind === 'vacant' ? '○ vacant desk' : '○ open desk', 10, 18);
    x.fillStyle = 'rgba(21,20,20,.30)'; x.font = '13px Menlo, monospace';
    x.fillText(kind === 'vacant' ? 'hire: office new-agent' : 'room to grow', 10, 52);
  } else {
    x.fillStyle = chip; x.fillRect(0, 0, 256, 26);
    x.fillStyle = '#151414'; x.font = 'bold 15px Menlo, monospace';
    x.fillText(kind === 'running' ? '● working' : '● idle', 10, 18);
    x.font = '13px Menlo, monospace';
    (lines ?? []).slice(-4).forEach((l, i, arr) => {
      x.fillStyle = i === arr.length - 1 ? '#1E9070' : 'rgba(21,20,20,.78)';
      x.fillText(String(l).slice(0, 28), 10, 48 + i * 22);
    });
  }
  screenSet.tex.needsUpdate = true;
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

/* ---------- department billboards — real metrics: runs today · last activity · approvals ---------- */
function hiredIn(k) { return DEPTS[k].agents.filter(a => a.hired).map(a => R[a.id]); }
function deptRows(k) {
  return [
    ['RUNS TODAY', () => hiredIn(k).reduce((s, r) => s + (todayTotals(r).runs_today ?? 0), 0)],
    ['LAST ACTIVITY', () => {
      const ts = Math.max(0, ...hiredIn(k).map(r => r.lastEventTs || 0));
      return ts ? ago(ts) : '—';
    }],
  ];
}
function todayTotals(r) {
  const t = r.totals ?? {};
  return t.day === new Date().toISOString().slice(0, 10) ? t : {};
}
function buildBillboards() {
  const keys = hasBrain ? [...DEPT_ORDER, 'brain'] : DEPT_ORDER;
  for (const k of keys) {
    const isBrain = k === 'brain';
    const dept = isBrain ? BRAIN : DEPTS[k];
    const n = isBrain ? 0 : hiredIn(k).length;
    const b = document.createElement('div');
    b.className = 'badge';
    b.innerHTML = `
      <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${isBrain ? 'THE BRAIN' : dept.name}<span class="live"></span></div>
      <div class="b-count">${isBrain ? '<span class="b-num">∞</span><span class="b-lab">KNOWLEDGE</span>' : `<span class="b-num">${n}</span><span class="b-lab">AGENT${n === 1 ? '' : 'S'}</span>`}</div>
      ${isBrain ? '' : `<div class="b-metrics">${deptRows(k).map((row, i) => `
        <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-m="${k}-${i}">${row[1]()}</span></div>`).join('')}
      </div>`}
      <div class="b-appr" style="display:none">⚠ <span class="ap-n">1</span> WAITING APPROVAL</div>`;
    b.addEventListener('click', (e) => {
      if (e.target.closest('.b-appr')) { zoomToApproval(k); e.stopPropagation(); }
      else enterFocus(k);
    });
    if (isBrain) b.style.display = 'none'; // the constellation speaks for itself
    hud.appendChild(b);
    deptRT[k].badge = b;
    deptRT[k].vals = isBrain ? [] : deptRows(k).map(row => String(row[1]()));
    deptRT[k].apprRow = b.querySelector('.b-appr');
    deptRT[k].apprN = b.querySelector('.ap-n');
    const L = LAYOUT[k];
    // y 8.6 clears the name pills; side-dock right-column pods so centred cards
    // never cover the Brain (v2 lesson — support/ops were side-docked)
    const sideDock = !isBrain && L.pos[0] > 0;
    if (sideDock) {
      deptRT[k].badgeAnchor = new THREE.Vector3(L.pos[0] + L.w / 2 + 3.5, 4, L.pos[1] - 4);
      deptRT[k].sideBadge = true;
    } else {
      deptRT[k].badgeAnchor = new THREE.Vector3(
        L.pos[0] - (isBrain ? 16 : 0), isBrain ? 14.5 : 8.6, L.pos[1] - (isBrain ? 0 : 9.6));
    }
  }
}
function updateBillboards() {
  for (const k of DEPT_ORDER) {
    deptRows(k).forEach((row, i) => {
      const nv = String(row[1]());
      if (nv !== deptRT[k].vals[i]) {
        deptRT[k].vals[i] = nv;
        const el = deptRT[k].badge.querySelector(`[data-m="${k}-${i}"]`);
        if (el) {
          el.textContent = nv;
          el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
        }
        const rel = document.querySelector(`[data-rm="${k}-${i}"]`); // docked rail copy
        if (rel) {
          rel.textContent = nv;
          rel.classList.remove('flash'); void rel.offsetWidth; rel.classList.add('flash');
        }
      }
    });
  }
}
function syncTopTag() {
  const hired = Object.values(R).filter(r => r.hired).length;
  document.getElementById('tag').textContent =
    `${hired} AGENT${hired === 1 ? '' : 'S'} · ${DEPT_ORDER.length} DEPARTMENT${DEPT_ORDER.length === 1 ? '' : 'S'}`;
}
function syncWarnings() {
  const w = OFFICE?.warnings ?? [];
  const el = document.getElementById('warnTag');
  if (!w.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.textContent = `⚠ ${w.length} CONFIG WARNING${w.length === 1 ? '' : 'S'}`;
  el.title = w.join('\n');
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
let focused = null;

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
  const pHits = ray.intersectObjects(personTargets, false);
  if (pHits.length) {
    openAgent(pHits[0].object.userData.agentId, 'chat');
    return;
  }
  const hits = ray.intersectObjects(clickTargets, false);
  if (hits.length) {
    const dk = hits[0].object.userData.dept;
    if (dk !== focused) enterFocus(dk);
  }
});
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') { if (rail.classList.contains('hireOpen')) { rail.classList.remove('hireOpen'); hireFor = null; } else if (modalOpen) railBack(); else zoomOut(); }
  else if (e.key === '+' || e.key === '=') zoomStep(1.5);
  else if (e.key === '-' || e.key === '_') zoomStep(1 / 1.5);
  else if (e.key === '0') zoomOut();
  else if (e.key >= '1' && e.key <= '6') {
    const dept = DEPT_ORDER[+e.key - 1];
    if (dept && focused !== dept) enterFocus(dept);
  }
  else if (e.key === 'c' || e.key === 'C') { // in a department: open its lead agent's chat
    if (focused && focused !== 'brain') {
      const first = hiredIn(focused)[0];
      if (first) openAgentRail(first.id, 'chat');
    }
  }
});

canvas.addEventListener('dblclick', (e) => {
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  if (!ray.intersectObjects(clickTargets, false).length) zoomOut();
});

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

function zoomOut() {
  if (focused && focused !== 'brain') { exitFocus(true); return; }
  focused = null;
  flyTo(HOME, 1, 550);
  syncOverviewBtn();
}
document.getElementById('overviewBtn').addEventListener('click', zoomOut);
function syncOverviewBtn() {
  document.getElementById('overviewBtn').classList.toggle('show',
    (view.zoom > 1.45 && !(tween && tween.toZ <= 1.05)) || !!focused);
}

/* ---------- focus rail: dept billboard + agent rows; agent CHAT & ACTIVITY sheet ---------- */
const chatHist = {};
const rail = document.getElementById('rail');
const vignette = document.getElementById('vignette');
const mMsgs = document.getElementById('mMsgs');
let modalOpen = null, modalTab = 'chat';
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
function railSide(k) { return LAYOUT[k] && LAYOUT[k].pos[0] < 0 ? 'left' : 'right'; }

function chatPush(id, msg, { silent = false } = {}) {
  (chatHist[id] ??= []).push(msg);
  if (chatHist[id].length > 120) chatHist[id].shift();
  if (!silent && modalOpen === id && modalTab === 'chat') renderChat(id);
}
function renderChat(id) {
  mMsgs.innerHTML = (chatHist[id] ?? []).map((m) => {
    if (m.who === 'agent') return `<div class="m-agent">${esc(m.text)}</div>`;
    if (m.who === 'user') return `<div class="m-user">${esc(m.text)}</div>`;
    if (m.who === 'work') return `<div class="m-work"><span class="wi">${m.i || '▸'}</span>${esc(m.text)}</div>`;
    if (m.who === 'file') return `
      <div class="m-file">
        <div class="f-head"><span>📎</span><div><div class="f-name">${esc(m.name)}</div><div class="f-meta">${esc(m.path ?? '')}${m.size ? ` · ${(m.size / 1024).toFixed(1)} KB` : ''}</div></div></div>
      </div>`;
    if (m.who === 'appr') return `
      <div class="m-appr" data-ap="${esc(m.apId)}">
        <div class="a-who">needs your approval</div>
        <div class="a-ask">${esc(m.text)}</div>
        ${(m.files ?? []).map(f => `<div class="f-meta">📎 ${esc(f)}</div>`).join('')}
        ${m.resolved === null
          ? `<div class="a-btns"><button class="a-yes">APPROVE</button><button class="a-no">REJECT</button></div>
             <div class="a-note" style="display:none"><input placeholder="notes back to the agent (optional)"><button class="a-send">SEND REJECTION</button></div>`
          : `<div class="a-done">${m.resolved === 'ok' ? '✓ Approved' : '✗ Rejected'}</div>`}
      </div>`;
    return '';
  }).join('');
  mMsgs.querySelectorAll('.m-appr').forEach(el => {
    const apId = el.dataset.ap;
    el.querySelector('.a-yes')?.addEventListener('click', () => decide(apId, 'approve'));
    el.querySelector('.a-no')?.addEventListener('click', () => {
      const n = el.querySelector('.a-note');
      n.style.display = n.style.display === 'none' ? 'flex' : 'none';
      n.querySelector('input')?.focus();
    });
    el.querySelector('.a-send')?.addEventListener('click', () =>
      decide(apId, 'reject', el.querySelector('.a-note input')?.value ?? ''));
  });
  mMsgs.scrollTop = mMsgs.scrollHeight;
}
async function decide(apId, decision, notes) {
  try {
    const res = await fetch(`/api/approvals/${encodeURIComponent(apId)}/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, ...(notes?.trim() ? { notes: notes.trim() } : {}) }),
    });
    const out = await res.json();
    if (!out.ok) chatPush(modalOpen, { who: 'work', i: '⚠️', text: out.error ?? 'decision failed' });
    // the approval_decided event updates the card + state — nothing optimistic here
  } catch (err) {
    chatPush(modalOpen, { who: 'work', i: '⚠️', text: `decision failed: ${err.message}` });
  }
}
function renderActivity(id) {
  const r = R[id];
  const last = r.feed[0];
  document.getElementById('mNow').innerHTML = last ? `LAST &nbsp;<b>${esc(last.text)}</b>` : 'No activity yet.';
  const t = todayTotals(r);
  const tiles = [
    ['RUNS TODAY', t.runs_today ?? 0],
    ['TOKENS TODAY', ((t.tokens_today ?? 0) / 1000).toFixed(1) + 'k'],
    ['EST API VALUE', '$' + (t.cost_today ?? 0).toFixed(2)],
    ['LAST RUN', r.summary?.last_run ? ago(Date.parse(r.summary.last_run.started)) : '—'],
  ];
  document.getElementById('mStats').innerHTML = tiles.map(([l, v]) => `
    <div class="st"><div class="st-l">${esc(l)}</div><div class="st-v">${esc(String(v))}</div></div>`).join('');
  document.getElementById('mFeed').innerHTML = r.feed.slice(0, 40).map(f => `
    <div class="fe"><span class="fi">${f.i}</span><span>${esc(f.text)}</span><span class="ft">${ago(f.ts)}</span></div>`).join('');
}
function focusTarget(k, atPos) {
  const base = atPos ? [atPos.x, 0, atPos.z] : [LAYOUT[k].pos[0], 0, LAYOUT[k].pos[1] + 1];
  const zoom = atPos ? 3.6 : 3.0;
  const pxPerWorld = zoom * innerHeight / (2 * FR);
  const shift = (Math.min(400, innerWidth * 0.92) / 2 + 30) / pxPerWorld;
  const dir = railSide(k) === 'left' ? -shift : shift;
  return { pos: [base[0] + SCREEN_RIGHT.x * dir, 0, base[2] + SCREEN_RIGHT.z * dir], zoom };
}
let pendingTab = 'chat';
function enterFocus(k, pendingAgentId) {
  if (k === 'brain') {
    focused = 'brain';
    flyTo([LAYOUT.brain.pos[0], 0, LAYOUT.brain.pos[1] + 1.5], 3.1, 700);
    syncOverviewBtn();
    return;
  }
  if (focused === k && !pendingAgentId) return;
  if (focused && focused !== k) { rail.classList.remove('open', 'agentOpen'); modalOpen = null; }
  focused = k;
  focusDimTarget = 1;
  applySceneDim(k);
  vignette.classList.add('on');
  const t = focusTarget(k);
  flyTo(t.pos, t.zoom, 950, {
    arc: railSide(k) === 'left' ? 0.10 : -0.10,
    onDone: () => { if (pendingAgentId) openAgentRail(pendingAgentId, pendingTab); pendingTab = 'chat'; },
  });
  buildDeptRail(k);
  rail.className = railSide(k);
  rail.style.display = 'block';
  document.getElementById('overviewBtn').classList.toggle('right', railSide(k) === 'left');
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
  focusDimTarget = 0;
  vignette.classList.remove('on');
  rail.classList.remove('open', 'agentOpen');
  setTimeout(() => { if (!focused) rail.style.display = 'none'; }, 650);
  document.getElementById('overviewBtn').classList.remove('right');
  if (k !== 'brain' && deptRT[k]?.badge) deptRT[k].badge.style.display = '';
  if (flyOut) flyTo(HOME, 1, 700);
  syncOverviewBtn();
}
function stuckIn(k) { return hiredIn(k).filter(r => r.state === 'stuck'); }
function buildDeptRail(k) {
  const dept = DEPTS[k];
  const hired = hiredIn(k);
  const rh = document.getElementById('railHeader');
  rh.classList.remove('show');
  rh.innerHTML = `
    <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${dept.name}<span class="live"></span></div>
    <div class="b-count"><span class="b-num">${hired.length}</span><span class="b-lab">AGENT${hired.length === 1 ? '' : 'S'}</span></div>
    <div class="b-metrics">${deptRows(k).map((row, i) => `
      <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-rm="${k}-${i}">${row[1]()}</span></div>`).join('')}</div>
    <div class="b-appr" style="display:${stuckIn(k).length ? 'flex' : 'none'}">⚠ <span class="ap-n">${stuckIn(k).length}</span> WAITING APPROVAL</div>`;
  rh.querySelector('.b-appr').addEventListener('click', () => {
    const s = stuckIn(k)[0];
    if (s) openAgentRail(s.id);
  });
  const rows = document.getElementById('railRows');
  rows.innerHTML = dept.agents.map((entry) => {
    if (!entry.hired) return `<div class="arow vacantRow" data-id="${esc(entry.id)}">
      <div class="av" style="background:rgba(21,20,20,.05);border:1.5px dashed rgba(21,20,20,.25)">·</div>
      <div class="a-main">
        <div class="a-name" style="color:var(--grey)">${esc(entry.id.toUpperCase())}</div>
        <div class="a-line">vacant desk — click to hire</div>
      </div>
      <div class="a-st">VACANT</div>
    </div>`;
    const r = R[entry.id];
    const last = r.feed[0];
    const st = r.state === 'stuck' ? '⚠ NEEDS YOU' : r.state === 'running' ? 'WORKING' : 'IDLE';
    return `<div class="arow" data-id="${esc(entry.id)}">
      <div class="av" style="background:${dept.chip}55;border:1.5px solid ${dept.chip}">${esc(entry.id[0].toUpperCase())}</div>
      <div class="a-main">
        <div class="a-name">${r.lead ? '<span class="star">★</span>' : ''}${esc((r.summary?.display_name ?? entry.id).toUpperCase())}</div>
        <div class="a-line" data-line="${esc(entry.id)}">${last ? last.i + ' ' + esc(last.text) : '—'}</div>
      </div>
      <div class="a-st${r.state === 'stuck' ? ' warn' : ''}" data-st="${esc(entry.id)}">${st}</div>
    </div>`;
  }).join('');
  rows.querySelectorAll('.arow:not(.vacantRow)').forEach(el =>
    el.addEventListener('click', () => openAgentRail(el.dataset.id)));
  rows.querySelectorAll('.arow.vacantRow').forEach(el =>
    el.addEventListener('click', () => openHire(el.dataset.id, k)));
}
function cascadeRows() {
  document.querySelectorAll('#railRows .arow').forEach((el, i) => {
    el.style.transitionDelay = (280 + i * 85) + 'ms';
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.style.transitionDelay = '0ms'; }, 1600);
  });
}
function flyBillboardIntoRail(k) {
  const badge = deptRT[k].badge;
  const from = badge.getBoundingClientRect();
  badge.style.display = 'none';
  const side = railSide(k);
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
function openAgentRail(id, tab = 'chat') {
  const r = R[id];
  if (!r?.hired) return;
  rail.classList.remove('hireOpen');
  modalOpen = id;
  const dept = DEPTS[r.dept];
  document.querySelector('#railAgent .mh-dot').style.background = dept.chip;
  document.querySelector('#railAgent .mh-name').innerHTML =
    (r.lead ? '<span class="star">★ </span>' : '') + esc((r.summary?.display_name ?? id).toUpperCase());
  document.querySelector('#railAgent .mh-role').textContent = dept.name;
  const s = r.summary?.session;
  document.querySelector('#railAgent .mh-tag').textContent =
    s ? `${s.model}/${s.effort} · ${scheduleLabel(r.summary?.schedule)}` : '';
  rail.classList.add('agentOpen');
  document.querySelectorAll('#railRows .arow').forEach(el =>
    el.classList.toggle('sel', el.dataset.id === id));
  setTab(tab);
  const t = focusTarget(r.dept, r.seat);
  flyTo(t.pos, t.zoom, 500);
}
function scheduleLabel(sch) {
  const cron = sch?.triggers?.find(t => t.type === 'cron');
  return cron ? `cron ${cron.when}` : 'manual';
}
function railBack() {
  modalOpen = null;
  rail.classList.remove('agentOpen');
  document.querySelectorAll('#railRows .arow').forEach(el => el.classList.remove('sel'));
  const t = focusTarget(focused);
  flyTo(t.pos, t.zoom, 500);
}
document.getElementById('railBack').addEventListener('click', railBack);
function openAgent(id, tab = 'chat') {
  const r = R[id];
  if (!r?.hired) return;
  if (focused === r.dept) { openAgentRail(id, tab); return; }
  pendingTab = tab;
  enterFocus(r.dept, id);
}
function setTab(tab) {
  modalTab = tab;
  document.querySelectorAll('#rail .mtabs button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('mChat').style.display = tab === 'chat' ? 'flex' : 'none';
  document.getElementById('mAct').style.display = tab === 'activity' ? 'flex' : 'none';
  document.getElementById('mSet').style.display = tab === 'settings' ? 'flex' : 'none';
  if (tab === 'chat') renderChat(modalOpen);
  else if (tab === 'activity') renderActivity(modalOpen);
  else renderSettings(modalOpen);
}

/* ---------- settings: model/effort (applies next session) + burn readout ---------- */
function renderSettings(id) {
  const r = R[id];
  const t = todayTotals(r);
  document.getElementById('setBurn').innerHTML = [
    ['RUNS TODAY', t.runs_today ?? 0],
    ['TOKENS TODAY', ((t.tokens_today ?? 0) / 1000).toFixed(1) + 'k'],
    ['EST API VALUE', '$' + (t.cost_today ?? 0).toFixed(2)],
    ['LAST RUN', r.summary?.last_run ? ago(Date.parse(r.summary.last_run.started)) : '—'],
  ].map(([l, v]) => `<div class="st"><div class="st-l">${esc(l)}</div><div class="st-v">${esc(String(v))}</div></div>`).join('');
  const s = r.summary?.session ?? {};
  document.getElementById('setModel').value = s.model ?? 'sonnet';
  document.getElementById('setEffort').value = s.effort ?? 'medium';
  document.getElementById('setMsg').textContent = '';
}
document.getElementById('setSave').addEventListener('click', async () => {
  const id = modalOpen;
  if (!id) return;
  const msg = document.getElementById('setMsg');
  msg.classList.remove('err');
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(id)}/settings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: document.getElementById('setModel').value,
        effort: document.getElementById('setEffort').value,
      }),
    });
    const out = await res.json();
    if (out.ok) {
      msg.textContent = '✓ saved — applies from the next session';
      if (R[id].summary?.session) {
        R[id].summary.session.model = document.getElementById('setModel').value;
        R[id].summary.session.effort = document.getElementById('setEffort').value;
      }
    } else { msg.classList.add('err'); msg.textContent = out.error ?? 'save failed'; }
  } catch (err) { msg.classList.add('err'); msg.textContent = `save failed: ${err.message}`; }
});

/* ---------- hire: vacant desk → the blank-custom wizard, in-office ---------- */
let hireFor = null; // { id, deptKey }
function openHire(id, deptKey) {
  if (focused !== deptKey) { enterFocus(deptKey); }
  hireFor = { id, deptKey };
  const dept = DEPTS[deptKey];
  document.querySelector('#railHire .mh-dot').style.background = dept.chip;
  document.getElementById('hireName').textContent = id.toUpperCase();
  document.getElementById('hireDept').textContent = dept.name;
  document.getElementById('hireMsg').textContent = '';
  rail.classList.remove('agentOpen');
  rail.classList.add('hireOpen');
}
document.getElementById('hireBack').addEventListener('click', () => {
  rail.classList.remove('hireOpen');
  hireFor = null;
});
document.getElementById('hireGo').addEventListener('click', async () => {
  if (!hireFor) return;
  const msg = document.getElementById('hireMsg');
  msg.classList.remove('err');
  const instr = document.getElementById('hireInstr').value.trim();
  if (!instr) { msg.classList.add('err'); msg.textContent = 'give the agent a job — one paragraph'; return; }
  msg.textContent = 'hiring…';
  try {
    const res = await fetch('/api/hire', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        NAME: hireFor.id,
        DEPARTMENT: DEPTS[hireFor.deptKey].name,
        SCHEDULE: document.getElementById('hireSched').value.trim() || 'manual',
        MODEL: document.getElementById('hireModel').value,
        EFFORT: document.getElementById('hireEffort').value,
        INSTRUCTIONS: instr,
      }),
    });
    const out = await res.json();
    if (out.ok) {
      msg.textContent = '✓ hired — rebuilding the office…';
      location.hash = `#view=${hireFor.deptKey}`;
      setTimeout(() => location.reload(), 700);
    } else { msg.classList.add('err'); msg.textContent = out.error ?? 'hire failed'; }
  } catch (err) { msg.classList.add('err'); msg.textContent = `hire failed: ${err.message}`; }
});
document.querySelectorAll('#rail .mtabs button').forEach(b =>
  b.addEventListener('click', () => setTab(b.dataset.tab)));
async function sendChat(text) {
  const id = modalOpen;
  if (!id || !text.trim()) return;
  document.getElementById('mIn').value = '';
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(id)}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
    });
    const out = await res.json();
    if (!out.ok) chatPush(id, { who: 'work', i: '⚠️', text: out.error ?? 'send failed' });
    // the user_say event echoes the message into the chat — nothing optimistic
  } catch (err) {
    chatPush(id, { who: 'work', i: '⚠️', text: `send failed: ${err.message}` });
  }
}
document.getElementById('mSend').addEventListener('click', () =>
  sendChat(document.getElementById('mIn').value));
document.getElementById('mIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat(e.target.value);
  e.stopPropagation();
});

/* ---------- agent state (from real events only) ---------- */
function setAgentState(id, state) {
  const r = R[id];
  if (!r || r.state === state) return;
  r.state = state;
  r.warn.visible = state === 'stuck';
  if (r.screenSet) drawScreen(r.screenSet, r.screenLines, DEPTS[r.dept].chip, state === 'running' ? 'running' : 'idle');
  if (focused === r.dept) {
    const st = document.querySelector(`[data-st="${id}"]`);
    if (st) {
      st.textContent = state === 'stuck' ? '⚠ NEEDS YOU' : state === 'running' ? 'WORKING' : 'IDLE';
      st.classList.toggle('warn', state === 'stuck');
    }
  }
}
function syncApprovals() {
  let total = 0;
  for (const k of DEPT_ORDER) {
    const n = stuckIn(k).length; total += n;
    if (!deptRT[k]) continue;
    deptRT[k].apprRow.style.display = n ? 'flex' : 'none';
    deptRT[k].apprN.textContent = n;
  }
  const top = document.getElementById('topAppr');
  top.style.display = total ? 'inline-flex' : 'none';
  top.querySelector('span').textContent = total;
  if (focused && focused !== 'brain') {
    const n = stuckIn(focused).length;
    const ap = document.querySelector('#railHeader .b-appr');
    if (ap) { ap.style.display = n ? 'flex' : 'none'; ap.querySelector('.ap-n').textContent = n; }
  }
}
function zoomToApproval(k) {
  const s = stuckIn(k)[0];
  if (!s) { enterFocus(k); return; }
  if (focused === k) openAgentRail(s.id);
  else enterFocus(k, s.id);
}
document.getElementById('topAppr').addEventListener('click', () => {
  const s = Object.values(R).find(r => r.state === 'stuck');
  if (s) zoomToApproval(s.dept);
});

/* ---------- SSE bridge — /api/events (history replay, then live; v1 pattern) ---------- */
function isLive(ev) { const t = Date.parse(ev.ts || ''); return isNaN(t) ? true : t >= LIVE_FROM; }
function feedAdd(r, i, text, ts) {
  const t = ts ? Date.parse(ts) : Date.now();
  r.feed.unshift({ i, text, ts: isNaN(t) ? Date.now() : t });
  if (r.feed.length > 60) r.feed.pop();
  r.lastEventTs = Math.max(r.lastEventTs, isNaN(t) ? Date.now() : t);
}
function handleEvent(ev) {
  if (!ev || typeof ev !== 'object') return;
  if (ev.type === 'replay_done') { LIVE_FROM = 0; updateBillboards(); syncApprovals(); return; }
  const id = String(ev.agent || '').split('/').pop();
  const r = R[id];
  if (!r) return;
  const live = isLive(ev);
  const icon = ev.icon || '';
  switch (ev.type) {
    case 'work': {
      chatPush(id, { who: 'work', i: icon || '▸', text: ev.text || '' });
      feedAdd(r, icon || '▸', ev.text || '', ev.ts);
      r.screenLines.push(ev.text || '');
      if (r.screenLines.length > 4) r.screenLines.shift();
      if (live) {
        drawScreen(r.screenSet, r.screenLines, DEPTS[r.dept].chip, r.state === 'running' ? 'running' : 'idle');
        spawnEmote(r, icon || '▸');
        liveRow(id, (icon || '▸') + ' ' + (ev.text || ''));
      }
      break;
    }
    case 'say':
      chatPush(id, { who: 'agent', text: ev.text || '' });
      feedAdd(r, '💬', (ev.text || '').split('\n')[0], ev.ts);
      if (live) spawnEmote(r, '💬');
      break;
    case 'user_say':
      chatPush(id, { who: 'user', text: ev.text || '' });
      break;
    case 'file':
      chatPush(id, { who: 'file', name: ev.name || String(ev.path || '').split('/').pop(), path: ev.path, size: ev.size });
      feedAdd(r, '📎', 'Deliverable: ' + (ev.name || ev.path || ''), ev.ts);
      if (live) spawnEmote(r, '📎');
      break;
    case 'approval': {
      if (ev.approval_id && !APPROVALS.some(x => x.id === ev.approval_id)) {
        APPROVALS.push({ id: ev.approval_id, agentId: id, summary: ev.summary, files: ev.files ?? [] });
        chatPush(id, { who: 'appr', apId: ev.approval_id, text: ev.summary || ev.text || '', files: ev.files ?? [], resolved: null });
      }
      feedAdd(r, '⚠️', ev.text || 'approval requested', ev.ts);
      setAgentState(id, 'stuck');
      syncApprovals();
      break;
    }
    case 'approval_decided': {
      const ok = /^appro/i.test(String(ev.decision || ''));
      const i = APPROVALS.findIndex(x => x.id === ev.approval_id);
      if (i >= 0) APPROVALS.splice(i, 1);
      const cm = (chatHist[id] ?? []).find(m => m.who === 'appr' && m.apId === ev.approval_id);
      if (cm) cm.resolved = ok ? 'ok' : 'no';
      feedAdd(r, ok ? '✅' : '✗', ev.text || '', ev.ts);
      if (!APPROVALS.some(x => x.agentId === id)) setAgentState(id, 'idle');
      if (live) {
        const now = performance.now();
        if (ok) r.cheerUntil = now + 2400; else r.slumpUntil = now + 2600;
        spawnEmote(r, ok ? '✅' : '❌');
      }
      if (modalOpen === id && modalTab === 'chat') renderChat(id);
      syncApprovals();
      break;
    }
    case 'run_start':
      setAgentState(id, 'running');
      feedAdd(r, '▶', ev.text || 'run started', ev.ts);
      break;
    case 'run_end':
      setAgentState(id, APPROVALS.some(x => x.agentId === id) ? 'stuck' : 'idle');
      feedAdd(r, '🏁', ev.text || 'run finished', ev.ts);
      if (live) pollAgents(); // pick up fresh totals right away
      break;
    case 'run_skip':
      feedAdd(r, '📭', ev.text || 'run skipped', ev.ts);
      break;
    case 'usage':
      feedAdd(r, '⛽', ev.text || '', ev.ts);
      break;
    case 'status':
      break; // session-up notice — feed noise, state comes from run_start/end
    case 'warn':
      chatPush(id, { who: 'work', i: '⚠️', text: ev.text || '' });
      feedAdd(r, '⚠️', ev.text || '', ev.ts);
      break;
    default:
      if (ev.text) feedAdd(r, icon || '·', ev.text, ev.ts);
  }
  if (live) {
    updateBillboards();
    if (modalOpen === id && modalTab === 'activity') renderActivity(id);
  }
}
function liveRow(id, line) {
  if (focused !== R[id]?.dept) return;
  const el = document.querySelector(`[data-line="${id}"]`);
  if (el) el.textContent = line;
}
function connectEvents() {
  let es;
  try { es = new EventSource('/api/events'); }
  catch { return; }
  es.onopen = () => { if (LIVE_FROM === Infinity) LIVE_FROM = Date.now() - 250; };
  es.onmessage = (e) => { let ev; try { ev = JSON.parse(e.data); } catch { return; } handleEvent(ev); };
  // EventSource reconnects automatically; on reconnect the server replays history,
  // which stays silent (ts < LIVE_FROM) so nothing double-announces.
}

/* ---------- desk life: poses reflect REAL state (no fake events) ---------- */
const MODES_RUNNING = [
  ['type', 0.55, 4000, 7500], ['read', 0.14, 3500, 6500], ['phone', 0.09, 4000, 8000],
  ['glance', 0.10, 2000, 3500], ['sip', 0.08, 2500, 4000], ['spin', 0.04, 1400, 2000],
];
const MODES_IDLE = [
  ['read', 0.42, 5000, 9000], ['sip', 0.25, 3000, 5000], ['glance', 0.33, 2500, 4500],
];
function pickWorkMode(r, now) {
  const MODES = r.state === 'running' ? MODES_RUNNING : MODES_IDLE;
  let x = Math.random();
  for (const [mode, w, dMin, dMax] of MODES) {
    x -= w;
    if (x <= 0 || mode === MODES[MODES.length - 1][0]) {
      r.workMode = mode;
      r.modeStart = now;
      r.modeUntil = now + dMin + Math.random() * (dMax - dMin);
      if (mode === 'glance')
        r.person.userData.glanceDir = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.25);
      return;
    }
  }
}
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
  const target = (mode === 'cheer' || mode === 'wave') ? FACE_CAM : r.seatRot;
  let d = target - r.person.rotation.y;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  r.person.rotation.y += d * (1 - Math.exp(-dt * 6));
}
const emoteTex = {};
function getEmoteTex(icon) {
  if (!emoteTex[icon]) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
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
  if (!r.person) return;
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

/* the thinking sweep — cosmetic brain theatre (only when a brain exists) */
const SWEEP_PERIOD = 16000;
function tickSweep(now) {
  if (!hasBrain) return null;
  const on = (!focused || focused === 'brain') ? 1 : 1 - focusDim;
  const theta = (now % SWEEP_PERIOD) / SWEEP_PERIOD * Math.PI * 2;
  let domDept = null, domS = 0;
  for (const k of DEPT_ORDER) {
    const az = Math.atan2(LAYOUT[k].pos[1], LAYOUT[k].pos[0]);
    const d = Math.atan2(Math.sin(theta - az), Math.cos(theta - az));
    let s = Math.max(0, 1 - Math.abs(d) / 0.7);
    s = s * s * (3 - 2 * s) * on;
    if (s > domS) { domS = s; domDept = k; }
    const b = deptRT[k].badge;
    if (!b) continue;
    if (s > 0.55 && !b.classList.contains('sweepglow')) {
      b.style.setProperty('--sw', DEPTS[k].chip);
      b.classList.add('sweepglow');
    } else if (s <= 0.35 && b.classList.contains('sweepglow')) b.classList.remove('sweepglow');
  }
  return { theta, strength: domS, col: domDept ? DEPTS[domDept].chip : '#FFFFFF' };
}

function tickSim(now, dt) {
  for (const r of Object.values(R)) {
    if (!r.person) continue;
    if (r.state === 'stuck') {
      poseWork(r.person, 'wave', now + r.bob * 500, dt);
      applyStandAndFacing(r, 'wave', now, dt);
      const p = r.person.position;
      r.warn.position.set(p.x, p.y + 5.9, p.z);
      const k = 2.6 + Math.sin(now / 240) * 0.5;
      r.warn.scale.set(k, k, 1);
      continue;
    }
    let mode;
    if (r.cheerUntil && now < r.cheerUntil) mode = 'cheer';
    else if (r.slumpUntil && now < r.slumpUntil) mode = 'slump';
    else {
      if (!r.modeUntil) {
        pickWorkMode(r, now);
        r.modeUntil = now + 400 + Math.random() * 4000;
      } else if (now > r.modeUntil || (r.state === 'running') !== (r.lastPoseState === 'running')) {
        pickWorkMode(r, now);
      }
      mode = r.workMode;
    }
    r.lastPoseState = r.state;
    poseWork(r.person, mode, now + r.bob * 500, dt);
    applyStandAndFacing(r, mode, now, dt);
  }
  tickEmotes(now, dt);
  if (brainNet) brainNet.tick(now, dt, tickSweep(now));
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
  const badgeScale = 1.02 - 0.3 * smooth(1.2, 2.6, z);
  for (const [k, d] of Object.entries(deptRT)) {
    if (!d.badge) continue;
    if (focused === k && k !== 'brain') continue; // this billboard is docked in the rail
    let [sx, sy] = toScreen(d.badgeAnchor);
    const bh = d.badge.offsetHeight * badgeScale, bw = d.badge.offsetWidth * badgeScale;
    let xf;
    if (d.sideBadge) {
      sy = clamp(sy, 64 + bh / 2, innerHeight - bh / 2 - 8);
      sx = clamp(sx, 8, innerWidth - bw - 8);
      xf = 'translate(0,-50%)';
    } else {
      sy = clamp(sy, bh + 64, innerHeight - 12);
      sx = clamp(sx, bw / 2 + 8, innerWidth - bw / 2 - 8);
      xf = 'translate(-50%,-100%)';
    }
    d.badge.style.transform = `translate(${sx}px,${sy}px) ${xf} scale(${badgeScale})`;
    d.badge.style.opacity = 1 - 0.75 * focusDim;
    d.badge.style.pointerEvents = 'auto';
  }
  const pillScale = 0.62 + 0.38 * smooth(1.2, 2.4, z);
  for (const r of Object.values(R)) {
    if (!r.pill) continue;
    const p = r.person ? r.person.position : r.seat;
    const [sx, sy] = toScreen(v3.set(p.x, p.y + 5.9 * (r.lead ? 1.12 : 1), p.z).clone());
    r.pill.style.display = 'block';
    r.pill.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-100%) scale(${pillScale})`;
    const dimmed = focused && focused !== 'brain' && r.dept !== focused;
    r.pill.style.opacity = dimmed ? 1 - 0.85 * focusDim : 1;
  }
}

/* ---------- clock (REAL local time — locked rule) ---------- */
function tickClock() {
  const d = new Date();
  document.getElementById('clock').textContent =
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(tickClock, 1000); tickClock();

/* ---------- boot + loop ---------- */
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  applyCamera();
}
addEventListener('resize', resize);
resize();

// deterministic view hooks for headless screenshots: #view=<deptkey> | #zoom=2.2
function applyHashHooks() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('zoom')) view.zoom = parseFloat(h.get('zoom')) || 1;
  if (h.get('view') && LAYOUT[h.get('view')]) enterFocus(h.get('view'));
  syncOverviewBtn();
}
window.CC = { flyTo, zoomOut, zoomToApproval, openAgent, enterFocus, view, applyCamera, R, deptRT, handleEvent };

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  tickTween(now);
  applyCamera();
  tickDim(dt);
  tickSim(now, dt);
  tickLOD();
  syncOverviewBtn();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
boot();
