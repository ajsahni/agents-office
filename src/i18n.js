// Opt-in Spanish layer for the UI chrome. Nothing runs unless ?lang=es, or the browser language is Spanish and no ?lang= says otherwise.
// It walks the DOM once, then keeps up with ONE MutationObserver. Text it does not know stays English.
// ponytail: exact-match dictionary + a few regex rules. Ceiling: strings built from several text nodes or from server data
// ("waiting 3 min · routine · …"), and anything drawn into a <canvas>, stay English. Add an entry, or a rule, when you meet one.

const DAYS = { mon: 'Lun', tue: 'Mar', wed: 'Mié', thu: 'Jue', fri: 'Vie', sat: 'Sáb', sun: 'Dom' };
const MONTHS = { jan: 'Enero', feb: 'Febrero', mar: 'Marzo', apr: 'Abril', may: 'Mayo', jun: 'Junio', jul: 'Julio', aug: 'Agosto', sep: 'Septiembre', oct: 'Octubre', nov: 'Noviembre', dec: 'Diciembre' };
const cap = k => k[0].toUpperCase() + k.slice(1);
const FULL = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' };
const mon = m => { const k = m.slice(0, 3).toLowerCase(), full = MONTHS[k]; return m.length <= 3 ? full.slice(0, 3) : full; };

// English UI string (trimmed, whitespace collapsed) -> Spanish. Same casing as the source; short, for fixed-width chips.
const DICT = new Map(Object.entries({
  // departments
  'EMAILS': 'CORREOS', 'SALES': 'VENTAS', 'OPERATIONS': 'OPERACIONES', 'FINANCE': 'FINANZAS',
  'ACCOUNTING': 'CONTABILIDAD', 'DELIVERY': 'ENTREGA', 'THE BRAIN': 'EL CEREBRO', 'WHOLE OFFICE': 'TODA LA OFICINA',
  'Emails': 'Correos', 'Sales': 'Ventas', 'Operations': 'Operaciones', 'Accounting': 'Contabilidad', 'Delivery': 'Entrega', 'Finance': 'Finanzas',
  // top bar, rail, brain overlay
  '◷ CALENDAR': '◷ CALENDARIO', 'the calendar — tasks and routines on their days (P)': 'el calendario: tareas y rutinas en sus días (P)',
  'CONNECTORS': 'CONECTORES', 'CONNECTED TO': 'CONECTADO A', '· CONNECTED TO': '· CONECTADO A', 'RUNS HEADLESS ON': 'SE EJECUTA SIN INTERFAZ EN',
  'nothing yet — connect in claude.ai or run: claude mcp add': 'nada aún: conecta en claude.ai o ejecuta: claude mcp add',
  'SESSION': 'SESIÓN', 'WEEK': 'SEMANA', 'LIMIT': 'LÍMITE', 'THIS WINDOW': 'ESTA VENTANA', 'RUNS': 'EJECUCIONES', 'RESETS': 'REINICIA', 'USAGE UNAVAILABLE': 'USO NO DISPONIBLE',
  'ACTIVITY': 'ACTIVIDAD', 'SEND': 'ENVIAR', '◂ OVERVIEW': '◂ VISTA GENERAL',
  'Message this agent… (add task: … · every weekday at 8am, … · approve / reject)': 'Escribe a este agente… (add task: … · every weekday at 8am, … · approve / reject)',
  'needs your approval': 'requiere tu aprobación', 'APPROVE': 'APROBAR', 'REJECT': 'RECHAZAR', '✓ Approved by AJ': '✓ Aprobado por AJ', '✗ Rejected by AJ': '✗ Rechazado por AJ',
  'NOW': 'AHORA', 'KNOWLEDGE': 'CONOCIMIENTO', 'AGENTS': 'AGENTES', 'NOTES': 'NOTAS', 'NOTES INDEXED': 'NOTAS INDEXADAS', 'open the Brain (G)': 'abrir el Cerebro (G)',
  'WAITING APPROVAL': 'ESPERANDO APROBACIÓN', '⚠ WAITING APPROVAL': '⚠ ESPERANDO APROBACIÓN',
  'Search the Brain…': 'Buscar en el Cerebro…', 'Esc closes · scroll zooms · drag pans · click a note to read it': 'Esc cierra · rueda hace zoom · arrastrar mueve · clic en una nota para leerla',
  'close (Esc)': 'cerrar (Esc)', 'close (Esc · P)': 'cerrar (Esc · P)',
  'Click a note to read it. Hover to see its neighbours.': 'Haz clic en una nota para leerla. Pasa el cursor para ver sus vecinas.',
  'the alerts on the Brain are distracting': 'las alertas del Cerebro distraen',
  // pod stats
  'EMAILS SENT': 'CORREOS ENVIADOS', 'REPLIES DRAFTED': 'RESPUESTAS REDACTADAS', 'REPORTS SENT': 'INFORMES ENVIADOS', 'ON TRACK': 'EN CURSO',
  'NEW MANAGERS': 'NUEVOS GERENTES', 'AUTO-ONBOARDED': 'AUTO-INCORPORADOS', 'NEW INSIGHTS': 'NUEVOS HALLAZGOS', 'COST PER USER': 'COSTO POR USUARIO',
  'PROPOSALS MADE': 'PROPUESTAS HECHAS', 'INVOICES ISSUED': 'FACTURAS EMITIDAS', 'BILLS PAID': 'PAGOS HECHOS',
  'DOING': 'EN CURSO', 'NEXT': 'SIGUIENTE', 'DONE': 'HECHO',
  // calendar
  'MONTH': 'MES', 'TODAY': 'HOY', 'previous (←)': 'anterior (←)', 'next (→)': 'siguiente (→)', 'today (T)': 'hoy (T)',
  'move ·': 'mover ·', 'view ·': 'vista ·', 'today ·': 'hoy ·', 'close': 'cerrar',
  'CALENDAR': 'CALENDARIO', 'routine run': 'ejecución de rutina', 'routine runs': 'ejecuciones de rutina', 'scheduled': 'programadas', 'done': 'hechas', // calendar.js stats: lowercase in source, uppercased by CSS
  'Search tasks and routines…': 'Buscar tareas y rutinas…', 'ROUTINES': 'RUTINAS', 'SCHEDULED': 'PROGRAMADO',
  'Click any day to schedule a task for it, or switch on REPEAT to start a routine from that date. Click a routine here to see only its days.': 'Haz clic en un día para programar una tarea, o activa REPETIR para iniciar una rutina desde esa fecha. Haz clic en una rutina para ver solo sus días.',
  'No routines yet.': 'Aún no hay rutinas.', 'Click a day, write what should happen, switch on REPEAT.': 'Haz clic en un día, escribe qué debe pasar, activa REPETIR.',
  'PAUSED': 'EN PAUSA', '· waits for your OK': '· espera tu OK', 'ONLY THIS ROUTINE ✕': 'SOLO ESTA RUTINA ✕', 'ONLY THIS': 'SOLO ESTA',
  'SCHEDULE FOR': 'PROGRAMAR PARA', 'That day has passed — pick today or a day after it.': 'Ese día ya pasó: elige hoy o un día posterior.',
  'which model runs it': 'qué modelo la ejecuta', 'What should happen that day?': '¿Qué debe pasar ese día?',
  'A task for this day — it runs at that time and lands in the panel. REPEAT makes it a routine from this date.': 'Una tarea para este día: se ejecuta a esa hora y aparece en el panel. REPETIR la convierte en rutina desde esta fecha.',
  'Claude is naming the agent…': 'Claude está eligiendo al agente…', 'Adding…': 'Agregando…', 'Could not add it.': 'No se pudo agregar.',
  'SCHEDULED TASK': 'TAREA PROGRAMADA', 'CANCEL IT': 'CANCELARLA', 'OPEN THE AGENT': 'ABRIR EL AGENTE', 'ROUTINE': 'RUTINA', '· read-only': '· solo lectura',
  'RUN NOW': 'EJECUTAR YA', 'RESUME': 'REANUDAR', 'PAUSE': 'PAUSAR', 'DELETE': 'ELIMINAR', 'CANCEL': 'CANCELAR',
  'Every day': 'Cada día', 'Every weekday': 'Cada día hábil', 'Mondays': 'Los lunes', 'Tuesdays': 'Los martes', 'Wednesdays': 'Los miércoles', 'Thursdays': 'Los jueves',
  'Fridays': 'Los viernes', 'Saturdays': 'Los sábados', 'Sundays': 'Los domingos', 'Every hour, 9–5, weekdays': 'Cada hora, 9–17, días hábiles',
  // task panel
  'department': 'departamento', 'Type a task…': 'Escribe una tarea…', 'open the big editor (⌘⇧E)': 'abrir el editor grande (⌘⇧E)',
  'which model runs this (the office default unless you change it)': 'qué modelo la ejecuta (el predeterminado de la oficina, salvo que lo cambies)',
  "how hard it thinks: Auto is the model's own level (Opus runs at high); Low to Max as Claude Code names them": 'cuánto razona: Auto es el nivel propio del modelo (Opus usa high); de Low a Max como los nombra Claude Code',
  'REPEAT': 'REPETIR', 'repeat on a schedule (or just say when: every weekday at 8am, …)': 'repetir en un horario (o di cuándo: every weekday at 8am, …)',
  'TEAM': 'EQUIPO', 'a team: the department lead splits the task across its desks, they work at the same time, the lead writes the final (or just say “as a team”)': 'equipo: el líder del departamento reparte la tarea entre sus puestos, trabajan a la vez y el líder redacta el resultado final (o di “as a team”)',
  'ADD': 'AGREGAR', 'how often': 'con qué frecuencia', "at what time (this machine's clock)": 'a qué hora (reloj de este equipo)',
  'needs my OK': 'necesita mi OK', 'the result waits for your approval before anything is sent': 'el resultado espera tu aprobación antes de enviar nada',
  'TASK STATUS': 'ESTADO DE TAREAS', 'TASK FOR': 'TAREA PARA', 'Write the task, or a whole brief…': 'Escribe la tarea o un brief completo…',
  'adds ·': 'agrega ·', 'closes': 'cierra',
  'All': 'Todas', 'Scheduled': 'Programado', 'Backlog': 'Pendiente', 'In progress': 'En curso', 'Waiting': 'En espera', 'Done': 'Hecho',
  'BACKLOG': 'PENDIENTE', 'IN PROGRESS': 'EN CURSO', 'WAITING': 'EN ESPERA', 'WAITING ON APPROVAL': 'ESPERANDO APROBACIÓN',
  'Nothing here right now.': 'No hay nada por ahora.', 'NEXT ⏱': 'SIGUIENTE ⏱', 'Routine ·': 'Rutina ·', 'Team ·': 'Equipo ·', 'Today\'s board': 'Tablero de hoy',
  'just now': 'ahora', 'just added': 'recién agregada',
  'No routines yet. Type one with a time in it — "every weekday at 8am, …" — or press REPEAT. Press': 'Aún no hay rutinas. Escribe una con una hora, por ejemplo "every weekday at 8am, …", o pulsa REPETIR. Pulsa',
  'for the calendar to schedule a task for a date.': 'para abrir el calendario y programar una tarea para una fecha.',
  'Which day? Say "every Monday …" or "Mon and Thu …".': '¿Qué día? Di "every Monday …" o "Mon and Thu …".',
  'Pick a time that is still ahead.': 'Elige una hora que aún no haya pasado.',
  // models / effort (names stay; only the generic words)
  'Auto': 'Auto', 'office default': 'predeterminado de la oficina', 'this task': 'esta tarea', 'this routine': 'esta rutina', 'this agent': 'este agente',
  // profile panel
  'Done this week': 'Hecho esta semana', 'Waiting on you': 'Esperando tu respuesta', 'Avg turnaround': 'Tiempo medio de entrega', 'Tasks done — last 7 days': 'Tareas hechas: últimos 7 días',
  'Last read': 'Última lectura', 'Written by': 'Escrito por', 'New today ·': 'Nuevas hoy ·',
  // tooltips
  'zoom in (+)': 'acercar (+)', 'zoom out (−)': 'alejar (−)', 'overview (0)': 'vista general (0)',
  // weekdays / months (calendar header, cells, popovers)
  ...Object.fromEntries(Object.entries(DAYS).map(([k, v]) => [cap(k), v])),
  ...Object.fromEntries(Object.entries(MONTHS).flatMap(([k, v]) => [[cap(k), v.slice(0, 3)], [FULL[k], v]])),
}));
// Uppercase dates ("MON 3 NOVEMBER" in the day popover) are handled by the date rule below, not the map.

const EN = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const WD = 'mon|tue|wed|thu|fri|sat|sun';
// [regex, replacement]; replacement is a string with $1… or a function. Keep this list short.
const RULES = [
  [/^(.*) · ([\d.,]+) NOTES · (\d+) LINKS$/, '$1 · $2 NOTAS · $3 ENLACES'], // brain meta; $1 is the owner's name, kept as is
  [/^(\d+) agents$/, '$1 agentes'],
  [/^New today · (\d+)$/, 'Nuevas hoy · $1'],
  [/^\+?(\d+) more$/, (m, n) => (m[0] === '+' ? '+' : '') + n + ' más'],
  [/^(\d+) wiki links · nothing read yet$/, '$1 enlaces wiki · nada leído aún'],
  [/^Your Claude plan, as Claude Code shows it\. Session resets (.*) · week resets (.*)\.$/, 'Tu plan de Claude, como lo muestra Claude Code. La sesión reinicia $1 · la semana reinicia $2.'],
  [/^(.+) — (connected · blocked for agents in office\.config\.json)$/, '$1 — conectado · bloqueado para los agentes en office.config.json'],
  [/^(.+) — failed to connect$/, '$1 — falló la conexión'],
  [/^(.+) — connecting…$/, '$1 — conectando…'],
  [/^(.+) — needs authentication \(run claude, then \/mcp\)$/, '$1 — requiere autenticación (ejecuta claude y luego /mcp)'],
  [/^(.+) — headless$/, '$1 — sin interfaz'],
  [/^Type a task for (.+)…$/, (m, d) => 'Escribe una tarea para ' + (DICT.get(d.toUpperCase()) || d).toLowerCase() + '…'],
  [/^show (.+) in the task panel$/, (m, d) => 'mostrar ' + (DICT.get(d) || d) + ' en el panel de tareas'],
  [/^schedule something on (\d+) (\w+)$/, (m, d, mo) => `programar algo el ${d} ${mon(mo)}`],
  // "Mon 3 Nov", "MON 3 NOVEMBER", "3–9 November"
  [new RegExp(`^(?:(${WD}) )?(\\d{1,2}(?:–\\d{1,2})?) (${EN})$`, 'i'), (m, w, d, mo) => { const o = (w ? DAYS[w.toLowerCase()] + ' ' : '') + d + ' ' + mon(mo); return m === m.toUpperCase() ? o.toUpperCase() : o; }],
];

/** Spanish for one English string, or null when we do not know it. Pure; no DOM. */
export function translate(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const hit = DICT.get(t);
  if (hit !== undefined) return hit;
  for (const [re, rep] of RULES) if (re.test(t)) return t.replace(re, rep);
  return null;
}

// Containers that hold the owner's or the agents' own content. We never touch anything inside them.
const SKIP = [
  'input', 'textarea', 'pre', 'code', '[contenteditable]', 'script', 'style', // what people type and code
  '.m-agent', '.m-user', '.m-work', '.m-file', '.a-ask', '.a-mock', // chat bubbles, file cards, the approval's own text
  '#mChips', // chat suggestion chips: clicking one SENDS its text (main.js sendChat(b.textContent))
  '#mNow b', '#mFeed', // what the agent is doing now: task text
  '.mh-name', '.mh-role', '.mh-tag', // roster data (name, role, does)
  '.tp-t', '.tk-t', '.tt', '.tp-m', '.tk-m', '.cv-ev', '.cv-pop-t', '.cv-pop-p', '.cv-r-t', '.mrt-r', // task and routine titles and their metadata
  '#bvPane > :not(.bv-empty)', '#bvChips .bv-chip:not(.live)', '.readlab', // brain notes and vault groups (their empty state and "New today" chip are UI)
].join(',');

const ATTRS = ['title', 'placeholder', 'aria-label'];

function lang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q) return q.toLowerCase().slice(0, 2);
  return (navigator.language || '').toLowerCase().slice(0, 2);
}

function start() {
  document.documentElement.lang = 'es';
  const done = new WeakMap(); // node -> the Spanish we last wrote, so our own writes are never re-read
  const skipped = el => !!el && el.closest && !!el.closest(SKIP);

  function text(n) {
    const v = n.nodeValue;
    if (done.get(n) === v) return;
    const out = translate(v);
    if (out === null || skipped(n.parentElement)) return;
    const [, lead, , trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(v);
    const next = lead + out + trail;
    if (next === v) return;
    done.set(n, next); n.nodeValue = next;
  }
  function attrs(el) {
    if (!el.getAttribute || skipped(el.parentElement)) return; // the parent, not el: an <input>'s own placeholder is UI, its value is not
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v === null) continue;
      const out = translate(v);
      if (out !== null && out !== v) el.setAttribute(a, out); // a same-value setAttribute still fires the observer: without this check it loops forever
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return text(root);
    if (root.nodeType !== 1) return;
    attrs(root);
    if (skipped(root)) return;
    for (let c = root.firstChild; c; c = c.nextSibling) walk(c);
  }

  walk(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') text(m.target);
      else attrs(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  // ponytail: the observer sees <title> edits in <body> only; document.title is left in English.
}

if (typeof document !== 'undefined' && lang() === 'es') start();
