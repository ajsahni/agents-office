// Command Centre — design tokens + dynamic office layout (config-driven; no fake roster)

// Nominal.so tokens (locked design language)
export const TOKENS = {
  cream: '#FDFFF8',
  ink: '#151414',
  grey: '#5A5A5A',
  hairline: 'rgba(21,20,20,0.12)',
};

// Brain colours are fixed (sage); department colours arrive from /api/office.
export const BRAIN = { name: 'THE BRAIN', chip: '#D1DECD', ink: '#4C7A57', floor: '#E9EFE4' };

// Pod slots in world XZ, filled in config order. First four match the proven v2
// composition (quadrants around the centre); slots 5–6 sit top/bottom centre.
const POD_SLOTS = [
  [-30, -23], [30, -23], [-30, 23], [30, 23], [0, -34], [0, 34],
];
export const POD_W = 20, POD_D = 20;

// Layout for N departments (+ optional brain at the centre).
export function computeLayout(departments, hasBrain) {
  const out = {};
  if (hasBrain) out.brain = { pos: [0, 0], w: 16, d: 16 };
  departments.forEach((d, i) => {
    out[d.key] = { pos: POD_SLOTS[i % POD_SLOTS.length], w: POD_W, d: POD_D };
  });
  return out;
}

// Desk grid: every pod carries 4 stations (2×2) — unfilled slots are vacant
// desks; the office sells growth. grid = [col,row].
export const DESK_GRID = [[0, 0], [1, 0], [0, 1], [1, 1]];

// Deterministic person appearance from the agent id (users don't pick looks).
const HAIRS = ['#2b2b2b', '#3b2b1d', '#111111', '#7a3b12', '#1c1c2e', '#5a2d0c', '#0d0d0d', '#2a1a0e', '#8a4a1f', '#26140a'];
const SKINS = ['#E8B98E', '#F0C9A0', '#C68B59', '#F5D5B0', '#E0A878', '#9C6B43', '#D89F70', '#8A5A32', '#B07850'];
export function appearanceFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { hair: HAIRS[h % HAIRS.length], skin: SKINS[(h >> 4) % SKINS.length] };
}
