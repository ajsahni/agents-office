// V3.1 — the real connector list for the office. Served: GET /api/mcp (the MCP servers this
// machine's Claude Code is connected to) + /api/agents (the roster's tool preferences) become
// the `connectors` object initMcp() draws. Opened as a file: null → the demo list plays.
import { MCP_LOGOS } from './mcplogos.js';
import { DEPT_KEYS } from './data.js';

// brand inks for shared looms (a shared connector is wired to four or more pods)
const INK = { notion: '#151414', gmail: '#EA4335', slack: '#4A154B', zapier: '#FF4F00', claude_ai_Google_Drive: '#1FA463', googledrive: '#1FA463' };
const norm = s => String(s).toLowerCase().replace(/^claude\.ai\s+/, '').replace(/[^a-z0-9]/g, '');
function hue(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
export const inkOf = name => `hsl(${hue(name)} 52% 42%)`;

// a tile for a server we have no logo for: same white rounded square as the baked ones, the
// name's initials in a colour hashed from the name — stable across boots
export function tile(name) {
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const x = c.getContext('2d');
  const r = 34;
  x.beginPath(); x.roundRect(1, 1, 158, 158, r); x.fillStyle = '#fff'; x.fill();
  x.lineWidth = 2; x.strokeStyle = 'rgba(28,26,23,0.10)'; x.stroke();
  const words = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
  const ini = (words.length > 1 ? words[0][0] + words[1][0] : String(name).slice(0, 2)).toUpperCase();
  x.fillStyle = inkOf(name);
  x.font = `700 ${ini.length > 1 ? 64 : 76}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(ini, 80, 86);
  return c.toDataURL('image/png');
}

export function fromSummary(m, agents) {
  const byDept = Object.fromEntries(DEPT_KEYS.map(k => [k, []]));
  const logos = {}, status = {}, shared = {}, names = {}, off = [];
  for (const s of m.servers || []) {
    const key = s.key || s.id;
    logos[key] = MCP_LOGOS[key] || { name: s.name, img: tile(s.name) };
    names[key] = s.name;
    status[key] = s.denied ? 'denied' : (s.allowed ? s.status : 'denied');
    // only a usable server is wired to pods; the rest sit in the strip, grey, unwired — nothing flows
    if (status[key] !== 'connected') { off.push(key); continue; }
    for (const d of s.depts || []) if (byDept[d] && !byDept[d].includes(key)) byDept[d].push(key);
    if ((s.depts || []).length >= 4) shared[key] = INK[key] || INK[norm(s.name)] || inkOf(s.name);
  }
  const agentTools = agents ? Object.fromEntries(agents.map(a => [a.id, (a.tools || []).map(t => {
    const n = norm(t); const hit = (m.servers || []).find(s => s.key === n || norm(s.name) === n || s.id === t); return hit ? (hit.key || hit.id) : n;
  })])) : null;
  return { live: true, byDept, logos, status, shared, names, off, agentTools, servers: m.servers || [], tools: !!m.tools, web: !!m.web };
}

export async function loadConnectors({ timeout = 25000 } = {}) {
  if (!location.protocol.startsWith('http')) return null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    const [m, a] = await Promise.all([fetch('/api/mcp', { signal: ctl.signal }).then(r => r.ok ? r.json() : null),
                                      fetch('/api/agents', { signal: ctl.signal }).then(r => r.ok ? r.json() : null).catch(() => null)]);
    clearTimeout(t);
    if (!m) return null;
    return fromSummary(m, a && a.agents);
  } catch { return null; }
}
