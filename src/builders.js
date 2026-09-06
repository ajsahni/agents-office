// Agents Office v2 — procedural mesh builders (stylised 3D, Image-1/2 blend on nominal palette)
import * as THREE from 'three';

export const PLINTH_H = 2.6;
const WHITE = '#F7F7F2';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.02,
      ...(opts.emissive ? { emissive: opts.emissive, emissiveIntensity: opts.ei ?? 1 } : {}),
    }));
  }
  return matCache.get(key);
}

// Rounded-rectangle prism via extrusion. Origin at centre, extruded along Y.
const geoCache = new Map();
export function rboxGeo(w, d, h, r = 0.35) {
  const key = `${w}|${d}|${h}|${r}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); // extrude along +Y
  geoCache.set(key, g);
  return g;
}

export function rbox(w, d, h, color, r) {
  const m = new THREE.Mesh(rboxGeo(w, d, h, r), typeof color === 'string' ? mat(color) : color);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/* ---------- plinth: floating white pod with pastel dept floor ---------- */
export function makePlinth(w, d, floorColor) {
  const g = new THREE.Group();
  const body = rbox(w, d, PLINTH_H, WHITE, 0.9);
  body.position.y = -PLINTH_H;
  g.add(body);
  // pastel floor slab, inset hairline reveal
  const floor = rbox(w - 0.7, d - 0.7, 0.12, floorColor, 0.7);
  floor.position.y = 0;
  floor.castShadow = false;
  g.add(floor);
  return g;
}

/* ---------- floor title: serif letterspaced dept name lying on the floor ---------- */
export function makeFloorTitle(text, inkColor, width) {
  const c = document.createElement('canvas');
  const W = 1024, H = 192; c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.font = '700 92px Georgia, "Times New Roman", serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const sp = 14; // letterspacing via manual draw
  let total = 0;
  for (const ch of text) total += x.measureText(ch).width + sp;
  let cx0 = (W - total + sp) / 2;
  x.fillStyle = inkColor;
  for (const ch of text) {
    const cw = x.measureText(ch).width;
    x.fillText(ch, cx0 + cw / 2, H / 2 + 6);
    cx0 += cw + sp;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const h = width * (H / W);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.14;
  return m;
}

/* ---------- desk: wood top, white pedestals, monitor with live screen, chair ---------- */
export function makeDeskScreenTexture(chip) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  const draw = (lines) => {
    // live cream screen (v1 rule: wood desks with live cream/mint screens)
    x.fillStyle = '#FDFFF8'; x.fillRect(0, 0, 256, 160);
    x.fillStyle = chip; x.fillRect(0, 0, 256, 26);
    x.fillStyle = '#151414'; x.font = 'bold 15px Menlo, monospace'; x.fillText('● working', 10, 18);
    x.font = '13px Menlo, monospace';
    lines.forEach((l, i) => {
      x.fillStyle = i === lines.length - 1 ? '#1E9070' : 'rgba(21,20,20,.78)';
      x.fillText(l, 10, 48 + i * 22);
    });
  };
  draw(['▸ …', '▸ …', '▸ …']);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, canvas: c, ctx: x, draw };
}

export function makeDesk(chip) {
  const g = new THREE.Group();
  const top = rbox(5.2, 2.6, 0.22, '#DCC29A', 0.18); top.position.y = 2.1; g.add(top);
  const ped1 = rbox(0.9, 2.2, 1.9, WHITE, 0.12); ped1.position.set(-2.0, 0.1, 0); g.add(ped1);
  const ped2 = rbox(0.9, 2.2, 1.9, WHITE, 0.12); ped2.position.set(2.0, 0.1, 0); g.add(ped2);
  // monitor
  const screenSet = makeDeskScreenTexture(chip);
  // rbox extrudes UP from its position — bezel base sits just above the desk top
  const monBack = rbox(2.3, 0.14, 1.5, '#26262A', 0.08); monBack.position.set(0, 2.75, -0.85); g.add(monBack);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 1.3),
    new THREE.MeshBasicMaterial({ map: screenSet.tex })
  );
  screen.position.set(0, 3.5, -0.77); g.add(screen);
  const stand = rbox(0.16, 0.16, 0.45, '#3A3A3E', 0.05); stand.position.set(0, 2.32, -0.9); g.add(stand);
  // keyboard + mug
  const kb = rbox(1.5, 0.5, 0.07, '#EFEFEA', 0.06); kb.position.set(0, 2.22, 0.35); g.add(kb);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.3, 12), mat(chip));
  mug.position.set(1.9, 2.36, 0.4); mug.castShadow = true; g.add(mug);
  return { group: g, screenSet };
}

export function makeChair() {
  const g = new THREE.Group();
  const seat = rbox(1.3, 1.2, 0.22, '#8E998B', 0.35); seat.position.y = 1.25; g.add(seat);
  const back = rbox(1.25, 0.2, 1.35, '#7C8779', 0.3); back.position.set(0, 1.5, 0.62); g.add(back);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.85, 8), mat('#55555A'));
  pole.position.y = 0.82; g.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.1, 10), mat('#55555A'));
  base.position.y = 0.4; base.castShadow = true; g.add(base);
  return g;
}

/* ---------- stylised 3D person ---------- */
export function makePerson({ hair, skin, chip, lead }) {
  const g = new THREE.Group();
  const S = lead ? 1.12 : 1;
  const shirtCol = lead ? '#2B3245' : chip;
  const shirt = mat(shirtCol, { rough: 0.9 });
  const skinM = mat(skin, { rough: 0.7 });
  const hairM = mat(hair, { rough: 0.95 });
  const pantsM = mat('#3E4048', { rough: 0.95 });

  const legs = new THREE.Group();
  const legGeo = new THREE.CapsuleGeometry(0.16 * S, 0.75 * S, 3, 8);
  const legL = new THREE.Mesh(legGeo, pantsM); legL.position.set(-0.2 * S, 0.6 * S, 0);
  const legR = new THREE.Mesh(legGeo, pantsM); legR.position.set(0.2 * S, 0.6 * S, 0);
  legL.castShadow = legR.castShadow = true;
  legs.add(legL, legR); g.add(legs);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42 * S, 0.85 * S, 4, 12), shirt);
  torso.position.y = 1.75 * S; torso.castShadow = true; g.add(torso);

  if (lead) { // dept-coloured tie + gold pin (v1 lead rule)
    const tie = new THREE.Mesh(new THREE.ConeGeometry(0.11 * S, 0.55 * S, 4), mat(chip));
    tie.rotation.x = Math.PI; tie.position.set(0, 1.85 * S, 0.4 * S); g.add(tie);
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.06 * S, 8, 8),
      mat('#E5C158', { metal: 0.8, rough: 0.3, emissive: '#8a6d1f', ei: 0.4 }));
    pin.position.set(0.26 * S, 2.05 * S, 0.38 * S); g.add(pin);
  }

  const armGeo = new THREE.CapsuleGeometry(0.155 * S, 0.62 * S, 3, 8);
  const armL = new THREE.Mesh(armGeo, shirt); armL.castShadow = true;
  const armR = new THREE.Mesh(armGeo, shirt); armR.castShadow = true;
  const shL = new THREE.Group(); shL.position.set(-0.5 * S, 2.1 * S, 0); armL.position.y = -0.42 * S; shL.add(armL);
  const shR = new THREE.Group(); shR.position.set(0.5 * S, 2.1 * S, 0); armR.position.y = -0.42 * S; shR.add(armR);
  g.add(shL, shR);

  // big-head cartoon proportions (Image 2) — head pivots at the neck so it can turn/nod
  const headG = new THREE.Group();
  headG.position.y = 2.75 * S;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5 * S, 18, 16), skinM);
  head.position.y = 0.25 * S; head.castShadow = true; headG.add(head);
  const hairMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.54 * S, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
  hairMesh.position.y = 0.31 * S; headG.add(hairMesh);
  g.add(headG);

  g.userData = { legs, legL, legR, shL, shR, torso, headG, S };
  return g;
}

/* seated work poses — varied desk life, smoothly blended between modes */
export function poseWork(g, mode, t, dt) {
  const u = g.userData;
  u.legs.visible = false;
  // NOTE the camera sees agents from BEHIND — poses must read as back-view silhouettes.
  // z-rotation sign: negative shLz / positive shRz flare the arms OUTWARD past the head.
  // standK 0 = seated at desk, 1 = standing beside it (position lerp happens in main).
  const tg = { shLx: -1.05, shLz: 0.25, shRx: -1.05, shRz: -0.25, headRx: 0.04, headRy: 0, torsoRx: 0, posY: 0.55, standK: 0 };
  switch (mode) {
    case 'type':
      tg.shLx = -1.05 + Math.sin(t / 170) * 0.12;
      tg.shRx = -1.05 + Math.sin(t / 140 + 1.3) * 0.14;
      tg.headRx = 0.07 + Math.sin(t / 380) * 0.05;
      break;
    case 'read': // leans back off the keyboard, arms drop to the sides, head tilts at the screen
      tg.shLx = -0.3; tg.shLz = -0.35; tg.shRx = -0.3; tg.shRz = 0.35;
      tg.torsoRx = -0.12;
      tg.headRx = 0.18 + Math.sin(t / 650) * 0.05;
      break;
    case 'phone': // right arm visibly up and out to the ear, small nods
      tg.shRx = -2.3; tg.shRz = 0.55; tg.shLx = -0.4; tg.shLz = -0.2;
      tg.headRy = -0.18; tg.headRx = 0.05 + (Math.sin(t / 330) > 0.55 ? 0.09 : 0);
      break;
    case 'glance': // big head turn toward a neighbour
      tg.shLx = -0.9; tg.shRx = -0.9;
      tg.headRy = u.glanceDir || 0.55;
      break;
    case 'sip': // mug arm up and out, head tips back a touch
      tg.shRx = -2.0; tg.shRz = 0.5; tg.shLx = -0.6; tg.headRx = -0.12;
      break;
    case 'spin': // slow chair spin, arms out — rotation itself driven in main
      tg.shLx = -0.7; tg.shLz = -0.55; tg.shRx = -0.7; tg.shRz = 0.55;
      tg.headRx = -0.05;
      break;
    case 'stretch': // STANDS beside the desk, arms up in a wide V
      tg.standK = 1; tg.posY = 0.12;
      tg.shLx = -2.6; tg.shLz = -0.75; tg.shRx = -2.6; tg.shRz = 0.75;
      tg.headRx = -0.15; tg.torsoRx = -0.05;
      break;
    case 'wave': // STUCK: standing, facing the camera, waving for attention
      tg.standK = 1; tg.posY = 0.12;
      tg.shRx = -2.6; tg.shRz = 0.55 + Math.sin(t / 150) * 0.4;
      tg.shLx = -0.3; tg.shLz = -0.25;
      tg.headRx = -0.05;
      break;
    case 'cheer': // approval granted — standing, arms V, little hops
      tg.standK = 1;
      tg.posY = 0.12 + Math.abs(Math.sin(t / 150)) * 0.16;
      tg.shLx = -2.7; tg.shLz = -0.85 + Math.sin(t / 190) * 0.12;
      tg.shRx = -2.7; tg.shRz = 0.85 - Math.sin(t / 190) * 0.12;
      tg.headRx = -0.2;
      break;
    case 'slump': // approval rejected — head drops, arms droop
      tg.shLx = -0.2; tg.shLz = -0.3; tg.shRx = -0.2; tg.shRz = 0.3;
      tg.headRx = 0.45; tg.posY = 0.5;
      break;
  }
  if (!u.cur) u.cur = { ...tg };
  const k = 1 - Math.exp(-(dt || 0.016) * 7);
  for (const key in tg) u.cur[key] += (tg[key] - u.cur[key]) * k;
  u.shL.rotation.x = u.cur.shLx; u.shL.rotation.z = u.cur.shLz;
  u.shR.rotation.x = u.cur.shRx; u.shR.rotation.z = u.cur.shRz;
  u.headG.rotation.x = u.cur.headRx; u.headG.rotation.y = u.cur.headRy;
  u.torso.rotation.x = u.cur.torsoRx;
  u.legs.visible = u.cur.standK > 0.4;
  g.position.y = u.cur.posY + Math.sin(t / 460) * 0.02;
}

export function posePerson(g, pose, t = 0) {
  const u = g.userData;
  u.cur = null; // walking/standing sets rotations directly; work poses re-blend from here
  u.headG.rotation.x = 0; u.headG.rotation.y = 0;
  if (pose === 'walk') {
    u.legs.visible = true;
    const sw = Math.sin(t / 110);
    g.position.y = Math.abs(Math.cos(t / 110)) * 0.08;
    u.legL.rotation.x = sw * 0.55; u.legR.rotation.x = -sw * 0.55;
    u.shL.rotation.x = -sw * 0.45; u.shR.rotation.x = sw * 0.45;
    u.shL.rotation.z = 0.08; u.shR.rotation.z = -0.08;
  } else { // stand (meeting)
    u.legs.visible = true;
    g.position.y = 0;
    u.legL.rotation.x = u.legR.rotation.x = 0;
    u.shL.rotation.x = -0.15 + Math.sin(t / 500) * 0.05; u.shR.rotation.x = -0.15 - Math.sin(t / 500) * 0.05;
    u.shL.rotation.z = 0.15; u.shR.rotation.z = -0.15;
    u.headG.rotation.y = Math.sin(t / 900) * 0.12; // looks at the other attendee now and then
  }
}

/* ---------- holo work-screen (Image-2 style floating glass panel) ---------- */
export function makeHolo(agentName, chip, lines) {
  const c = document.createElement('canvas');
  const W = 512, H = 320; c.width = W; c.height = H;
  const x = c.getContext('2d');
  const draw = (ls) => {
    x.clearRect(0, 0, W, H);
    // glass card
    x.fillStyle = 'rgba(253,255,248,0.93)';
    roundRect(x, 6, 6, W - 12, H - 12, 26); x.fill();
    x.strokeStyle = chip; x.lineWidth = 5;
    roundRect(x, 6, 6, W - 12, H - 12, 26); x.stroke();
    // header
    x.fillStyle = chip;
    x.beginPath(); x.arc(40, 44, 11, 0, 7); x.fill();
    x.fillStyle = '#151414'; x.font = '700 27px Georgia, serif';
    x.fillText(agentName, 62, 54);
    x.strokeStyle = 'rgba(21,20,20,0.12)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(28, 76); x.lineTo(W - 28, 76); x.stroke();
    // terminal lines
    x.font = '20px Menlo, monospace';
    ls.forEach((l, i) => {
      x.fillStyle = i === ls.length - 1 ? '#1E9070' : 'rgba(21,20,20,0.72)';
      x.fillText(l.length > 40 ? l.slice(0, 40) + '…' : l, 30, 116 + i * 36);
    });
    // blinking caret line
    x.fillStyle = '#151414';
    x.fillRect(30, 116 + ls.length * 36 - 16, 12, 20);
  };
  draw(lines);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 3.0),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.96, depthWrite: false, side: THREE.DoubleSide })
  );
  m.userData.draw = draw;
  m.userData.tex = tex;
  return m;
}

function roundRect(x, a, b, w, h, r) {
  x.beginPath();
  x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r);
  x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r);
  x.arcTo(a, b, a + w, b, r);
  x.closePath();
}

/* ---------- props ---------- */
export function makePlant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 0.8, 10), mat('#B96A4B'));
  pot.position.y = 0.4; pot.castShadow = true; g.add(pot);
  const foliage = mat('#5F8A5C', { rough: 1 });
  const foliage2 = mat('#6F9B68', { rough: 1 });
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.42 + Math.sin(i * 7) * 0.12, 10, 8), i % 2 ? foliage : foliage2);
    s.position.set(Math.sin(i * 2.4) * 0.35, 1.15 + i * 0.28, Math.cos(i * 2.4) * 0.35);
    s.castShadow = true; g.add(s);
  }
  return g;
}

export function makeServerRack(chip) {
  const g = new THREE.Group();
  const body = rbox(1.6, 1.2, 3.4, '#232326', 0.14); g.add(body);
  for (let r = 0; r < 5; r++) {
    const slot = rbox(1.3, 0.06, 0.3, '#2E2E33', 0.04);
    slot.position.set(0, 0.5 + r * 0.6, 0.62); g.add(slot);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6),
      mat(r % 2 ? chip : '#E69393', { emissive: r % 2 ? chip : '#E69393', ei: 2.2 }));
    led.position.set(0.45, 0.65 + r * 0.6, 0.64); g.add(led);
  }
  return g;
}

export function makeMeetingTable() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.2, 28), mat('#EFEADF'));
  top.position.y = 1.9; top.castShadow = true; top.receiveShadow = true; g.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.9, 12), mat('#C9C4B8'));
  leg.position.y = 0.95; g.add(leg);
  return g;
}

/* ---------- the Brain: GALACTIC-CORE nebula + knowledge web + swirling outer band ----------
   M4 "HERO BRAIN" (AJ chose A+D from the reference video — a dark galaxy-core map where the
   centre is a dense multicolour particle nebula and departments light up one at a time):
   A = the nebula — ~1100 particles in the nominal + chip palette, packed bright at the
       centre, differential swirl (core spins faster, like a galaxy), per-particle shimmer,
       periodic "thought flashes" where a random cluster blooms.
   D = the thinking sweep — tick() accepts {theta, strength, col}: particles in that azimuth
       window brighten toward the dept chip colour while main.js orbits a comet + glows the
       dept billboard. The knowledge web stays as a compact hub lattice so the brain still
       reads as a knowledge graph, not just dust. */
export function makeNeuralBrain() {
  const g = new THREE.Group();
  const R = 5.2;
  const PI2 = Math.PI * 2;
  const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
  const dummy = new THREE.Object3D();

  /* the nebula — cylindrical coords so the swirl is a pure per-frame azimuth advance.
     DUAL PALETTE (M5): every particle carries a CREAM colour (ink-dominant dust that reads
     on the cream office with no dark backing — the M4 orb read as a storm-cloud shadow and
     is gone) and a GALAXY colour (the M4 bright set) — tick lerps between them by gk. */
  const N = 1100;
  const parts = [];
  const PAL_G = [ // galaxy mode: white-hot core + chip sparkle (needs a dark field)
    ['#FFFFFF', .24], ['#B9B9B2', .13], ['#8B8B85', .10],
    ['#5ADEB7', .12], ['#EADC8F', .12], ['#E69393', .09], ['#98A5EF', .09],
    ['#4C7A57', .05], ['#D9A05B', .03], ['#151414', .03],
  ];
  const PAL_C = [ // cream mode: ink/graphite carries the mass, deep chip tones sparkle
    ['#151414', .20], ['#3E3E3A', .16], ['#6E6E68', .15], ['#9A9A92', .08],
    ['#2E8B57', .11], ['#C8A438', .10], ['#C2574F', .08], ['#5A6ACF', .08],
    ['#4C7A57', .03], ['#D9A05B', .01],
  ];
  const pick = (PAL) => { let x = Math.random(); for (const [c, w] of PAL) { if ((x -= w) <= 0) return c; } return PAL[0][0]; };
  for (let i = 0; i < N; i++) {
    const rad = R * Math.pow(Math.random(), 0.62);              // clustered toward the core
    parts.push({
      rad, az: Math.random() * PI2,
      y: gauss() * R * 0.34 * (0.35 + 0.65 * (rad / R)),        // thin bright plane, puffier rim
      w: 0.00005 + 0.00013 * (1 - rad / R),                     // differential swirl speed
      base: (0.6 + Math.random() * 0.7) * (1 + 0.55 * (1 - rad / R)), // bigger toward centre
      colC: new THREE.Color(pick(PAL_C)),
      colG: new THREE.Color(pick(PAL_G)),
      phase: Math.random() * 7,
    });
  }
  const inst = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.10, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
  parts.forEach((p, i) => {
    dummy.position.set(p.rad * Math.cos(p.az), p.y, p.rad * Math.sin(p.az));
    dummy.scale.setScalar(p.base);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    inst.setColorAt(i, p.colC);
  });
  g.add(inst);

  /* knowledge web: a compact hub lattice INSIDE the nebula. Its nodes+edges live in their
     own group that rotates as one (edges must stay attached), while the dust swirls past. */
  const webG = new THREE.Group();
  g.add(webG);
  const NW = 90;
  const wnodes = [];
  for (let i = 0; i < NW; i++) {
    const dir = new THREE.Vector3(gauss(), gauss(), gauss()).normalize();
    const p = dir.multiplyScalar(R * (0.1 + 0.6 * Math.cbrt(Math.random())));
    p.y *= 0.7;
    const big = Math.random() < 0.3;
    wnodes.push({ p, big });
  }
  const winst = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.10, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), NW);
  wnodes.forEach((n, i) => {
    n.colC = new THREE.Color(n.big ? '#7A7A74' : '#454540'); // graphite on cream
    n.colG = new THREE.Color(n.big ? '#A8A8A1' : '#FFFFFF'); // light on the night field
    dummy.position.copy(n.p);
    dummy.scale.setScalar(n.big ? 1.7 : 0.9);
    dummy.updateMatrix();
    winst.setMatrixAt(i, dummy.matrix);
    winst.setColorAt(i, n.colC);
  });
  webG.add(winst);
  const edges = [];
  for (const n of wnodes) {
    const near = wnodes
      .filter(m => m !== n)
      .sort((a, b) => a.p.distanceToSquared(n.p) - b.p.distanceToSquared(n.p));
    for (let j = 0; j < (n.big ? 5 : 2); j++)
      if (near[j]) edges.push([n.p, near[j].p]);
  }
  const epos = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], i) => epos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6));
  const egeo = new THREE.BufferGeometry();
  egeo.setAttribute('position', new THREE.BufferAttribute(epos, 3));
  const webLineMat = new THREE.LineBasicMaterial({ color: 0x3A3A38, transparent: true, opacity: 0.15 });
  webG.add(new THREE.LineSegments(egeo, webLineMat)); // ink on cream, lerped light in galaxy mode
  // signal pulses along the web
  const pulses = [];
  const pulseCols = ['#5ADEB7', '#E69393', '#98A5EF', '#D9A05B', '#FFF8EC', '#EADC8F', '#5ADEB7', '#4C7A57'];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshBasicMaterial({ color: pulseCols[i] }));
    webG.add(m);
    pulses.push({ m, edge: edges[Math.floor(Math.random() * edges.length)], t: Math.random(), speed: 0.35 + Math.random() * 0.6 });
  }

  /* outer band: hundreds of loose dots in a swirling annulus (the "circle" read) */
  const bandG = new THREE.Group();
  g.add(bandG);
  const bandPts = [];
  let guard = 0;
  while (bandPts.length < 320 && guard++ < 5000) {
    // 3D shell: random direction, swirl gaps by azimuth, gently squashed vertically
    const dir = new THREE.Vector3(gauss(), gauss(), gauss()).normalize();
    const r = R * (1.35 + 0.75 * Math.random());
    const az = Math.atan2(dir.z, dir.x);
    if (Math.sin(az * 2.2 + r * 1.6) < -0.45) continue; // swirl gaps
    const p = dir.multiplyScalar(r);
    p.y *= 0.55;
    const x = Math.random();
    bandPts.push({
      p,
      colC: new THREE.Color(x < 0.32 ? '#C8A438' : x < 0.54 ? '#8B8B85' : x < 0.68 ? '#3E3E3A'
        : x < 0.80 ? '#2E8B57' : x < 0.90 ? '#C2574F' : '#5A6ACF'),
      colG: new THREE.Color(x < 0.32 ? '#EADC8F' : x < 0.54 ? '#8B8B85' : x < 0.68 ? '#FFFFFF'
        : x < 0.80 ? '#5ADEB7' : x < 0.90 ? '#E69393' : '#98A5EF'),
      phase: Math.random() * 7,
    });
  }
  const NB = bandPts.length;
  const band = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.085, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), NB);
  bandPts.forEach((n, i) => {
    dummy.position.copy(n.p);
    dummy.scale.setScalar(0.8 + Math.random() * 0.5);
    dummy.updateMatrix();
    band.setMatrixAt(i, dummy.matrix);
    band.setColorAt(i, n.colC);
  });
  bandG.add(band);
  /* links to the outer nodes (M5.5 per AJ — the band dots floated unconnected): local
     nearest-neighbour edges so the ring reads as constellations, plus sparse inward spokes
     tying the outer nodes back to the core. Lives INSIDE bandG so the lines rotate with
     their endpoints (M3.4 lesson: edges must stay attached). */
  const bandLineMat = new THREE.LineBasicMaterial({ color: 0x3A3A38, transparent: true, opacity: 0.12 });
  {
    const bedges = [];
    bandPts.forEach((n, i) => {
      const near = bandPts
        .filter(m => m !== n)
        .sort((a, b) => a.p.distanceToSquared(n.p) - b.p.distanceToSquared(n.p));
      if (near[0] && near[0].p.distanceTo(n.p) < 3.0) bedges.push([n.p, near[0].p]);
      if (near[1] && Math.random() < 0.45 && near[1].p.distanceTo(n.p) < 3.0) bedges.push([n.p, near[1].p]);
      if (i % 7 === 0) bedges.push([n.p, n.p.clone().multiplyScalar(0.45)]); // inward spoke to the core
    });
    const bpos = new Float32Array(bedges.length * 6);
    bedges.forEach(([a, b], i) => bpos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6));
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    bandG.add(new THREE.LineSegments(bgeo, bandLineMat));
  }

  /* M5: the M4 "space orb" dark backing is DELETED — on the cream office it read as a
     storm-cloud shadow (AJ). The cream palette above needs no backing; galaxy mode (gk→1)
     supplies the dark field page-wide instead. */
  /* tight warm-white glow at the very centre — near-invisible on cream, blooms in galaxy */
  let coreMat;
  {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const rg = x.createRadialGradient(128, 128, 4, 128, 128, 126);
    rg.addColorStop(0, 'rgba(255,252,240,0.95)');
    rg.addColorStop(0.3, 'rgba(255,250,232,0.45)');
    rg.addColorStop(1, 'rgba(255,250,232,0)');
    x.fillStyle = rg; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    coreMat = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.2 });
    const core = new THREE.Sprite(coreMat);
    core.scale.set(7.5, 7.5, 1);
    core.renderOrder = -1;
    g.add(core);
  }

  /* thought flashes: every few seconds a random cluster blooms bright — "having an idea" */
  let flash = null, nextFlashAt = 2200;
  const sweepCol = new THREE.Color('#FFFFFF');
  const tmpCol = new THREE.Color();
  const flashCol = new THREE.Color();
  const FLASH_C = new THREE.Color('#D9A05B'); // amber bloom reads on cream…
  const FLASH_G = new THREE.Color('#FFFFFF'); // …white bloom on the night field
  const WEB_LINE_C = new THREE.Color(0x3A3A38), WEB_LINE_G = new THREE.Color(0xFFF8EC);
  let lastGk = -1;

  const tick = (t, dt, sw, gk = 0) => {
    const swS = sw ? sw.strength : 0;
    const swTheta = sw ? sw.theta : 0;
    if (sw && sw.col) sweepCol.set(sw.col);
    // galaxy-mode crossfades (skip the instanced recolours when gk hasn't moved)
    coreMat.opacity = 0.2 + 0.8 * gk;
    webLineMat.color.copy(WEB_LINE_C).lerp(WEB_LINE_G, gk);
    webLineMat.opacity = 0.15 + 0.05 * gk;
    bandLineMat.color.copy(webLineMat.color);
    bandLineMat.opacity = 0.12 + 0.04 * gk;
    flashCol.copy(FLASH_C).lerp(FLASH_G, gk);
    if (Math.abs(gk - lastGk) > 0.004) {
      lastGk = gk;
      wnodes.forEach((n, i) => winst.setColorAt(i, tmpCol.copy(n.colC).lerp(n.colG, gk)));
      winst.instanceColor.needsUpdate = true;
      bandPts.forEach((n, i) => band.setColorAt(i, tmpCol.copy(n.colC).lerp(n.colG, gk)));
      band.instanceColor.needsUpdate = true;
    }
    webG.rotation.y = t * 0.00008;
    bandG.rotation.y = -t * 0.000035; // counter-rotating galaxy shear
    if (t > nextFlashAt) {
      flash = { az: Math.random() * PI2, rad: R * (0.15 + 0.55 * Math.random()), r: R * 0.38, t0: t };
      nextFlashAt = t + 2600 + Math.random() * 2600;
    }
    let fk = 0, fx = 0, fz = 0;
    if (flash) {
      const k = (t - flash.t0) / 950;
      if (k >= 1) flash = null;
      else { fk = Math.sin(k * Math.PI); fx = flash.rad * Math.cos(flash.az); fz = flash.rad * Math.sin(flash.az); }
    }
    for (let i = 0; i < N; i++) {
      const p = parts[i];
      const az = p.az + t * p.w; // differential swirl
      const x = p.rad * Math.cos(az), z = p.rad * Math.sin(az);
      let s = p.base * (1 + 0.32 * Math.sin(t / 620 + p.phase)); // shimmer
      tmpCol.copy(p.colC);
      if (gk > 0.004) tmpCol.lerp(p.colG, gk);
      if (swS > 0.01) { // the thinking sweep: this side of the brain leans toward the dept colour
        const d = Math.atan2(Math.sin(az - swTheta), Math.cos(az - swTheta));
        let sk = Math.max(0, 1 - Math.abs(d) / 0.62);
        sk = sk * sk * (3 - 2 * sk) * swS;
        if (sk > 0.01) { s *= 1 + 0.85 * sk; tmpCol.lerp(sweepCol, 0.6 * sk); }
      }
      if (fk > 0) { // thought flash bloom
        const dx = x - fx, dz = z - fz;
        const fb = fk * Math.max(0, 1 - Math.sqrt(dx * dx + dz * dz) / flash.r);
        if (fb > 0.01) { s *= 1 + 0.9 * fb; tmpCol.lerp(flashCol, 0.5 * fb); }
      }
      dummy.position.set(x, p.y, z);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      inst.setColorAt(i, tmpCol);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.instanceColor.needsUpdate = true;
    for (const p of pulses) {
      p.t += dt * p.speed;
      if (p.t >= 1) { p.t = 0; p.edge = edges[Math.floor(Math.random() * edges.length)]; }
      p.m.position.lerpVectors(p.edge[0], p.edge[1], p.t);
    }
  };
  return { group: g, tick };
}

/* ---------- pulsing ⚠ sprite for stuck agents (v1 rule) ---------- */
export function makeWarnSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.beginPath(); x.moveTo(64, 12); x.lineTo(120, 112); x.lineTo(8, 112); x.closePath();
  x.fillStyle = '#F2B84B'; x.fill();
  x.lineWidth = 7; x.strokeStyle = '#151414'; x.lineJoin = 'round'; x.stroke();
  x.fillStyle = '#151414'; x.font = '900 64px Inter, sans-serif';
  x.textAlign = 'center'; x.fillText('!', 64, 98);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(2.6, 2.6, 1);
  return s;
}

/* ---------- walkway bridge between two XZ points ---------- */
export function makeWalkway(from, to) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const g = rbox(len, 3.2, 0.35, '#EFEFE8', 0.16);
  g.position.set((from[0] + to[0]) / 2, -0.35, (from[1] + to[1]) / 2);
  g.rotation.y = -Math.atan2(dz, dx);
  return g;
}
