// Agents Office V3.5 — routine schedules. Shared by the page (src/tasks.js) and the server
// (routines.mjs): plain words → a schedule, a schedule → the next time it is due, and a
// schedule → the words the office uses to say it back. Local time throughout: the office keeps
// the machine's real clock and so do routines.
//
// when = { kind: 'daily' | 'weekdays' | 'weekly' | 'hourly' | 'minutes',
//          at: 'HH:MM'          (daily · weekdays · weekly)
//          days: [0..6]         (weekly: 0 = Sunday)
//          every: N             (hourly: every N hours · minutes: every N minutes)
//          from, to: 'HH:MM'    (hourly: the window, default the whole day)
//          weekdaysOnly: true   (hourly: skip Saturday and Sunday) }

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WORD_TIMES = { noon: '12:00', midday: '12:00', lunchtime: '12:30', midnight: '00:00', morning: '08:00', mornings: '08:00', afternoon: '14:00', afternoons: '14:00', evening: '17:00', evenings: '17:00', night: '20:00', nights: '20:00' };
const pad = n => String(n).padStart(2, '0');
const hhmm = (h, m = 0) => `${pad(h)}:${pad(m)}`;

function clock(h, m, ap) { // 8 → 08:00 · 8pm → 20:00 · 12am → 00:00 · 17 → 17:00
  h = +h; m = +(m || 0);
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return hhmm(h, m);
}
// one time in the sentence: "at 8", "at 8:30am", "8am", "08:00", "at noon", "in the morning"
const T_RE = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))\s*(am|pm|a\.m\.|p\.m\.)?\b|\bat\s+(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)?\b|\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/i;
function findTime(s) {
  const m = T_RE.exec(s);
  if (m) {
    const ap = (m[3] || m[5] || m[7] || '').replace(/\./g, '').toLowerCase() || null;
    const at = m[1] !== undefined ? clock(m[1], m[2], ap) : m[4] !== undefined ? clock(m[4], 0, ap) : clock(m[6], 0, ap);
    if (at) return { at, span: [m.index, m.index + m[0].length], guessed: false };
  }
  const w = /\b(?:at\s+|in\s+the\s+|every\s+|each\s+)?(noon|midday|lunchtime|midnight|mornings?|afternoons?|evenings?|nights?)\b/i.exec(s);
  if (w) { const word = w[1].toLowerCase(); return { at: WORD_TIMES[word], span: [w.index, w.index + w[0].length], guessed: !/^(noon|midday|midnight)$/.test(word), word }; }
  return null;
}
function dayIndex(word) {
  const w = word.toLowerCase().replace(/s$/, '');
  const i = DAYS.findIndex(d => d.startsWith(w.slice(0, 3)));
  return w.length >= 3 && i >= 0 ? i : -1;
}
const cut = (s, span) => (s.slice(0, span[0]) + ' ' + s.slice(span[1]));
function tidy(s) { // the task text with the schedule taken out
  return s.replace(/\s+/g, ' ').replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '').replace(/^(?:and|then|please|to)\s+/i, '').replace(/\s+,/g, ',').trim();
}

/** Plain words → { when, text, guessed, needsTime, needsDay } or null when there is no schedule in the sentence. */
export function parseWhen(input) {
  const src = String(input || '');
  let s = src, m;
  // every N minutes (filming cadence — accepted, never offered)
  if ((m = /\bevery\s+(\d+)\s*(?:min|mins|minutes?)\b/i.exec(s))) {
    return { when: { kind: 'minutes', every: Math.max(1, +m[1]) }, text: tidy(cut(s, [m.index, m.index + m[0].length])) };
  }
  // hourly · every N hours · every hour between 9 and 5 · every hour 9am-5pm on weekdays
  if ((m = /\b(?:hourly|every\s+(\d+\s+)?hours?|each\s+hour|once\s+an\s+hour)\b/i.exec(s))) {
    const when = { kind: 'hourly', every: Math.max(1, +(m[1] || 1)) };
    s = cut(s, [m.index, m.index + m[0].length]);
    const w = /\b(?:between|from)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:and|to|-|–|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(s);
    if (w) {
      let a = clock(w[1], w[2], w[3] ? w[3].toLowerCase() : null), b = clock(w[4], w[5], w[6] ? w[6].toLowerCase() : null);
      if (a && b) {
        if (!w[3] && !w[6] && +w[1] < 8 && +w[1] < +w[4]) a = clock(+w[1] + 12, w[2]); // "9-5": 9 stays, "1-5" reads as 13:00
        if (b < a && !w[6]) b = clock((+w[4] % 12) + 12, w[5]); // "9 to 5" → 17:00
        if (b > a) { when.from = a; when.to = b; s = cut(s, [w.index, w.index + w[0].length]); }
      }
    }
    if ((m = /\b(?:on\s+)?(?:week\s?days|working\s+days|business\s+days|mon(?:day)?\s*(?:-|–|to)\s*fri(?:day)?)\b/i.exec(s))) { when.weekdaysOnly = true; s = cut(s, [m.index, m.index + m[0].length]); }
    return { when, text: tidy(s) };
  }
  // weekdays
  if ((m = /\b(?:every|each|on|all)?\s*(?:week\s?days?|working\s+days?|business\s+days?|mon(?:day)?\s*(?:-|–|to|through)\s*fri(?:day)?)\b/i.exec(s))) {
    s = cut(s, [m.index, m.index + m[0].length]);
    const t = findTime(s); if (t) s = cut(s, t.span);
    return { when: { kind: 'weekdays', at: t ? t.at : null }, text: tidy(s), guessed: !!(t && t.guessed), guessWord: t && t.word, needsTime: !t };
  }
  // weekends
  if ((m = /\b(?:every|each|on|at)?\s*(?:the\s+)?weekends?\b/i.exec(s))) {
    s = cut(s, [m.index, m.index + m[0].length]);
    const t = findTime(s); if (t) s = cut(s, t.span);
    return { when: { kind: 'weekly', days: [6, 0], at: t ? t.at : null }, text: tidy(s), guessed: !!(t && t.guessed), guessWord: t && t.word, needsTime: !t };
  }
  // named days: every monday · mondays · on mon and thu · every tuesday and friday · each friday
  {
    const re = /\b(?:every|each|on|all|every\s+other)?\s*((?:(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?s?)(?:\s*(?:,|and|&|\+)\s*(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?s?)*)\b/i;
    if ((m = re.exec(s))) {
      const days = [...new Set(m[1].split(/\s*(?:,|and|&|\+)\s*/).map(dayIndex).filter(i => i >= 0))];
      if (days.length) {
        s = cut(s, [m.index, m.index + m[0].length]);
        const t = findTime(s); if (t) s = cut(s, t.span);
        s = s.replace(/\b(?:every|each)\s+week\b/i, ' ').replace(/\bweekly\b/i, ' ');
        return { when: { kind: 'weekly', days: days.sort((a, b) => a - b), at: t ? t.at : null }, text: tidy(s), guessed: !!(t && t.guessed), guessWord: t && t.word, needsTime: !t };
      }
    }
  }
  // weekly with no day named → ask for the day
  if ((m = /\b(?:weekly|every\s+week|once\s+a\s+week|each\s+week)\b/i.exec(s))) {
    s = cut(s, [m.index, m.index + m[0].length]);
    const t = findTime(s); if (t) s = cut(s, t.span);
    return { when: { kind: 'weekly', days: [], at: t ? t.at : null }, text: tidy(s), needsDay: true, needsTime: !t };
  }
  // daily: every day · daily · each day · every morning (time word doubles as the cadence)
  if ((m = /\b(?:daily|every\s+day|each\s+day|once\s+a\s+day|every\s+(?:morning|afternoon|evening|night)|each\s+(?:morning|afternoon|evening|night))\b/i.exec(s))) {
    const word = /(morning|afternoon|evening|night)/i.exec(m[0]);
    s = cut(s, [m.index, m.index + m[0].length]);
    const t = findTime(s);
    if (t) s = cut(s, t.span);
    const at = t ? t.at : word ? WORD_TIMES[word[1].toLowerCase()] : null;
    return { when: { kind: 'daily', at }, text: tidy(s), guessed: !t && !!word || !!(t && t.guessed), guessWord: t && t.guessed ? t.word : word ? word[1].toLowerCase() : undefined, needsTime: !at };
  }
  return null;
}

/** The REPEAT picker → a schedule. cadence: daily · weekdays · mon…sun · hourly · at: 'HH:MM' */
export function fromPicker(cadence, at) {
  const t = /^\d{2}:\d{2}$/.test(at || '') ? at : '08:00';
  if (cadence === 'daily') return { kind: 'daily', at: t };
  if (cadence === 'weekdays') return { kind: 'weekdays', at: t };
  if (cadence === 'hourly') return { kind: 'hourly', every: 1, from: '09:00', to: '17:00', weekdaysOnly: true };
  const d = dayIndex(cadence);
  if (d >= 0) return { kind: 'weekly', days: [d], at: t };
  return { kind: 'weekdays', at: t };
}

/** A schedule → the words the office says back. */
export function describe(when) {
  if (!when) return '';
  const at = when.at ? ' · ' + when.at : '';
  switch (when.kind) {
    case 'minutes': return `every ${when.every} min`;
    case 'hourly': return (when.every > 1 ? `every ${when.every} hours` : 'every hour') + (when.from ? ` ${when.from}–${when.to}` : '') + (when.weekdaysOnly ? ' · weekdays' : '');
    case 'daily': return 'every day' + at;
    case 'weekdays': return 'every weekday' + at;
    case 'weekly': {
      const d = (when.days || []);
      if (d.length === 7) return 'every day' + at;
      if (d.length === 2 && d.includes(0) && d.includes(6)) return 'weekends' + at;
      return (d.length === 1 ? DAYS[d[0]][0].toUpperCase() + DAYS[d[0]].slice(1) + 's' : d.map(i => SHORT[i]).join(', ')) + at;
    }
  }
  return '';
}

/** Is the schedule complete enough to run? */
export function valid(when) {
  if (!when || typeof when !== 'object') return false;
  const t = s => /^\d{2}:\d{2}$/.test(s || '');
  if (when.kind === 'minutes') return Number.isInteger(when.every) && when.every >= 1;
  if (when.kind === 'hourly') return Number.isInteger(when.every) && when.every >= 1 && (!when.from || (t(when.from) && t(when.to) && when.from < when.to));
  if (when.kind === 'daily' || when.kind === 'weekdays') return t(when.at);
  if (when.kind === 'weekly') return t(when.at) && Array.isArray(when.days) && when.days.length > 0 && when.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6);
  return false;
}

const mins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
/** The next time the schedule is due, strictly after `from` (ms, local time). */
export function nextRun(when, from = Date.now()) {
  if (!valid(when)) return null;
  const f = new Date(from);
  if (when.kind === 'minutes') { const step = when.every * 60000; return Math.floor(from / step) * step + step; }
  if (when.kind === 'hourly') {
    const start = when.from ? mins(when.from) : 0, end = when.to ? mins(when.to) : 24 * 60, step = when.every * 60;
    const d = new Date(f); d.setSeconds(0, 0); d.setMinutes(0); d.setHours(d.getHours() + 1); // the next whole hour after `from`
    for (let i = 0; i < 24 * 8; i++, d.setHours(d.getHours() + 1)) {
      const dow = d.getDay(), mm = d.getHours() * 60;
      if (when.weekdaysOnly && (dow === 0 || dow === 6)) continue;
      if (mm < start || mm > end) continue;
      if ((mm - start) % step !== 0) continue;
      return d.getTime();
    }
    return null;
  }
  const [hh, mi] = when.at.split(':').map(Number);
  const allowed = when.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : when.kind === 'weekdays' ? [1, 2, 3, 4, 5] : when.days;
  const d = new Date(f); d.setHours(hh, mi, 0, 0);
  for (let i = 0; i < 9; i++, d.setDate(d.getDate() + 1)) {
    if (d.getTime() <= from) continue;
    if (allowed.includes(d.getDay())) return d.getTime();
  }
  return null;
}

/** "in 2 min" · "at 08:00" · "Mon 09:00" · "Fri 16:00" — the countdown the cards show. */
export function untilText(ts, now = Date.now()) {
  if (!ts) return '—';
  const ms = ts - now;
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'in under a minute';
  if (m < 60) return `in ${m} min`;
  const d = new Date(ts), today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const t = hhmm(d.getHours(), d.getMinutes());
  if (sameDay) return `at ${t}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${t}`;
  return `${SHORT[d.getDay()]} ${t}`;
}
export const DAY_NAMES = DAYS;
