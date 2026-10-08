import { DEPTS, DEPT_KEYS, AGENTS, APPROVAL_BY_AGENT, APPROVAL_ASKS, WORKLINES } from './data.js';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const colors = Object.fromEntries(DEPT_KEYS.map((key) => [key, DEPTS[key].chip]));
const byDept = (dept) => AGENTS.filter((agent) => agent.dept === dept);
const initials = (name) => name.split(' ').map((part) => part[0]).slice(0, 2).join('');
let selectedDept = 'all';
let tasks = [
  { title: 'Review the September client report pack', agent: 'crep', state: 'IN PROGRESS', dept: 'delivery' },
  { title: 'Enrich overnight signups and route the batch', agent: 'enzo', state: 'RUNNING', dept: 'sales' },
  { title: 'Approve October content plan', agent: 'mlead', state: 'WAITING APPROVAL', dept: 'marketing' },
  { title: 'Reconcile unmatched card fees', agent: 'recon', state: 'QUEUED', dept: 'fin' },
];

function agent(id) { return AGENTS.find((item) => item.id === id) || AGENTS[0]; }
function showToast(message) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2400); }
function taskRows() {
  return tasks.filter((task) => selectedDept === 'all' || task.dept === selectedDept).map((task) => {
    const owner = agent(task.agent);
    return `<div class="queue-item"><div class="queue-title">${task.title}</div><div class="queue-meta"><span>${owner.name}</span><span class="pill">${task.state}</span></div></div>`;
  }).join('') || '<div class="queue-item"><div class="queue-title">No work in this view.</div></div>';
}
function render() {
  const activeAgents = selectedDept === 'all' ? AGENTS : byDept(selectedDept);
  app.innerHTML = `<header class="topbar"><div class="brand">AGENTS OFFICE <small>COMMAND CENTRE / V4</small></div><div class="status"><i></i> SYSTEM OPERATIONAL</div><div class="spacer"></div><div class="top-actions"><button class="ghost" id="refresh">Refresh activity</button><button class="primary" id="newTask">+ New task</button></div></header>
  <section class="hero"><div><div class="eyebrow">A working office for autonomous teams</div><h1>See the work. Route the next move.</h1><p>One place to dispatch tasks, monitor agents, and keep approvals close to the work. Built from the existing office roster and operating brain.</p></div><div class="heartbeat"><strong>35 agents</strong><span>6 departments · 4 active workflows</span></div></section>
  <section class="layout"><div class="panel"><div class="panel-head"><h2>Office floor</h2><span>${selectedDept === 'all' ? 'Overview' : DEPTS[selectedDept].name}</span></div><div class="office">${DEPT_KEYS.map((key) => { const list = byDept(key); const active = selectedDept === key; return `<button class="department ${active ? 'active' : ''}" style="--accent:${colors[key]}" data-dept="${key}"><div class="dept-top"><span class="dept-dot"></span><span class="dept-name">${DEPTS[key].name}</span></div><div class="dept-count">${list.length}</div><div class="dept-meta">agents assigned</div><div class="dept-foot"><span>${list.filter((a) => a.lead).length} lead</span><span>${WORKLINES[key]?.[0]?.replace('▸ ', '') || 'Standing by'}</span></div></button>`; }).join('')}</div><div class="panel-head"><h2>Live activity</h2><span>Updated just now</span></div><div class="feed">${activeAgents.slice(0, 5).map((a, index) => `<div class="feed-item"><span class="feed-mark">0${index + 1}</span><div class="feed-copy">${WORKLINES[a.dept]?.[index % (WORKLINES[a.dept]?.length || 1)] || 'Agent is ready for work'}<small>${a.name} · ${DEPTS[a.dept].name}</small></div></div>`).join('')}</div><div class="taskbar"><input id="taskInput" aria-label="Describe a task" placeholder="Tell the office what needs doing…" /><button class="primary" id="dispatch">Dispatch task</button></div></div>
  <aside class="panel"><div class="panel-head"><h2>Work queue</h2><span>${tasks.length} items</span></div><div class="queue">${taskRows()}</div><div class="panel-head"><h2>Office pulse</h2><span>Today</span></div><div class="metrics"><div class="metric"><strong>47</strong><span>leads enriched</span></div><div class="metric"><strong>23</strong><span>invoices issued</span></div><div class="metric"><strong>9.5h</strong><span>call hours routed</span></div><div class="metric"><strong>6</strong><span>proposals sent</span></div><div class="metric"><strong>31</strong><span>tickets resolved</span></div><div class="metric"><strong>3</strong><span>need approval</span></div></div><div class="panel-head"><h2>On call now</h2><span>${activeAgents.length} shown</span></div><div class="agent-list">${activeAgents.slice(0, 7).map((a) => `<div class="agent"><div class="avatar" style="background:${colors[a.dept]}">${initials(a.name)}</div><div><div class="agent-name">${a.name}</div><div class="agent-role">${a.lead ? 'Department lead' : DEPTS[a.dept].name}</div></div><span class="agent-state">${a.id === 'mlead' ? 'review' : 'working'}</span></div>`).join('')}</div></aside></section>`;
  bind();
}
function bind() {
  document.querySelectorAll('[data-dept]').forEach((button) => button.addEventListener('click', () => { selectedDept = selectedDept === button.dataset.dept ? 'all' : button.dataset.dept; render(); }));
  document.querySelector('#refresh').addEventListener('click', () => { showToast('Activity refreshed'); render(); });
  document.querySelector('#newTask').addEventListener('click', () => document.querySelector('#taskInput').focus());
  document.querySelector('#dispatch').addEventListener('click', dispatch);
  document.querySelector('#taskInput').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) dispatch(); });
}
function dispatch() {
  const input = document.querySelector('#taskInput'); const title = input.value.trim();
  if (!title) { input.focus(); return; }
  const owner = selectedDept === 'all' ? AGENTS.find((a) => a.lead) : byDept(selectedDept).find((a) => a.lead) || byDept(selectedDept)[0];
  tasks = [{ title, agent: owner.id, state: 'QUEUED', dept: owner.dept }, ...tasks];
  selectedDept = owner.dept; showToast(`Task routed to ${owner.name}`); render();
}
render();
setInterval(() => { const live = document.querySelector('.status'); if (live) live.title = `Last checked ${new Date().toLocaleTimeString()}`; }, 10000);
