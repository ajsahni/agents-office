import logo from '../assets/ember-spark.png';
import { applyTheme, defaultTheme } from './theme.js';
import { readJson } from './http.js';
const app = document.querySelector('#app');
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const departments = {
  marketing: 'Marketing',
  emails: 'Email',
  sales: 'Sales',
  ops: 'Operations',
  fin: 'Finance',
  delivery: 'Delivery',
};
const stages = { queued: 'Queued', active: 'In progress', review: 'In review', done: 'Completed' };
const providerNames = { openai: 'OpenAI', whatsapp: 'WhatsApp', manual: 'Manual' };
let user,
  workflows = [],
  activity = [],
  toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  document.querySelector('#toast').textContent = message;
  toastTimer = setTimeout(() => (document.querySelector('#toast').textContent = ''), 4500);
}
// Where to land after signing in. `?next=` wins, but only when it is a path on
// this site: an absolute URL there would turn the sign-in form into a redirect
// to somebody else's page.
function nextPath() {
  const raw = new URLSearchParams(location.search).get('next');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/workspace';
  if (['/login', '/signup'].includes(raw.split('#')[0])) return '/workspace';
  return raw;
}
async function api(route, method = 'GET', body) {
  const res = await fetch('/api/account/' + route, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Delux-Request': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return readJson(res, 'Unable to complete the request.');
}
function setUser(value) {
  user = value;
  applyTheme(user.theme);
}
function header(member = false) {
  return `<header class="header"><div class="wrap nav"><div class="brand"><details class="contact"><summary aria-label="Contact Onesmus" title="Contact Onesmus"><img src="${logo}" alt="Ember Spark" width="69" height="34"></summary><div class="contact-card"><strong>Contact Onesmus</strong><a href="mailto:emberspack@zohomail.com">emberspack@zohomail.com</a><a href="tel:+12089374658">+1 208 937 4658</a></div></details><a href="/" aria-label="Delux crew home"><span>Delux crew</span></a></div><nav class="nav-links" aria-label="Main navigation">${member ? '<a href="/workspace">Workspace</a><a href="/settings">Settings</a><a href="/office">3D office ↗</a>' : '<a href="/#experience">The experience</a><a href="/#connections">Connections</a><a href="/office">Explore the office ↗</a>'}</nav><div class="nav-actions">${member ? '<button class="button secondary small" id="logout">Sign out</button>' : '<a href="/login">Sign in</a><a class="button small" href="/signup">Get started <span aria-hidden="true">↗</span></a>'}</div></div></header>`;
}
function footer() {
  return (
    '<footer class="footer"><span>© ' +
    new Date().getFullYear() +
    ' Delux crew. A space for considered work.</span><div class="footer-links"><a href="mailto:emberspack@zohomail.com">Get in touch ↗</a><a href="/workspace">Your workspace</a></div></footer>'
  );
}
function bindHeader() {
  const contact = document.querySelector('.contact');
  document.addEventListener('click', (e) => {
    if (contact && !contact.contains(e.target)) contact.open = false;
  });
  contact?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      contact.open = false;
      contact.querySelector('summary').focus();
    }
  });
  document.querySelector('#logout')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api('logout', 'POST');
      location.assign('/login');
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
    }
  });
}
function landing() {
  app.innerHTML = `${header()}<main id="main" class="wrap"><section class="hero"><div><div class="eyebrow">Your work, beautifully in order</div><h1>Big ideas.<br>Clear direction.<br><em>Your own space.</em></h1><p class="intro">Bring your workflows, connections, and next steps together. Delux crew gives your ambition a workspace that feels entirely yours.</p><div class="actions"><a href="/signup" class="button">Create your workspace <span aria-hidden="true">↗</span></a><a href="#experience" class="button secondary">Discover the experience</a></div><p class="hero-note"><span class="dot"></span> Personal workspace · No card required · Your colors, your pace</p></div><div class="scene" aria-label="Illustrative workflow dashboard"><div class="demo-window"><div class="demo-head"><span>DELUX CREW / WORKSPACE</span><span class="demo-dots" aria-hidden="true"><i></i><i></i><i></i></span></div><div class="demo-body"><p class="demo-title">A little clarity. A lot of possibility.</p><p class="demo-sub">Every moving part, thoughtfully brought together.</p><div class="demo-stats"><div class="demo-stat"><b>08</b><span>Active workflows</span></div><div class="demo-stat"><b>03</b><span>Ready for review</span></div><div class="demo-stat"><b>12</b><span>Completed</span></div></div><div class="demo-row"><span class="demo-icon">✦</span><div>Shape the next campaign<small>Marketing · OpenAI planned</small></div><span class="pill active">In progress</span></div><div class="demo-row"><span class="demo-icon">↗</span><div>Welcome your next customer<small>Delivery · WhatsApp planned</small></div><span class="pill">In review</span></div><div class="demo-row"><span class="demo-icon">✓</span><div>Make room for what’s next<small>Operations · Manual</small></div><span class="pill">Completed</span></div></div></div><div class="floating-note"><span>✧</span> A workspace, made personal.</div><p class="scene-caption">An illustrative preview of your workspace</p></div></section><section id="connections" class="providers-band" aria-label="Service providers"><p>Your connections.<br>A world of possibility.</p><div class="provider-names"><a class="provider-name" href="/settings#openai"><span class="provider-mark" aria-hidden="true">✳</span><span>OpenAI<small>API access verification</small></span></a><a class="provider-name" href="/settings#whatsapp"><span class="provider-mark" aria-hidden="true">◉</span><span>WhatsApp<small>Business phone verification</small></span></a><a class="provider-name" href="/office"><span class="provider-mark" aria-hidden="true">⌘</span><span>3D office<small>Explore agents & tools</small></span></a></div></section><section class="section" id="experience"><div class="section-top"><div><div class="eyebrow">Designed around you</div><h2>Less scattered.<br>More intentional.</h2></div><p>From the first idea to the final check, give every piece of work a place — and give yourself a clearer view.</p></div><div class="features"><article class="feature"><span class="number">01 / YOUR WORK</span><h3>See the whole picture.</h3><p>Create workflows, set due dates, and move work from queued to completed. Your personal board and activity history keep the next step in sight.</p><a class="feature-link" href="/signup">Find your flow ↗</a></article><article class="feature"><span class="number">02 / YOUR CONNECTIONS</span><h3>Bring your tools closer.</h3><p>Save OpenAI and WhatsApp Business credentials, then verify API access in Settings. Associate a provider with your plans; execution remains a separate step.</p><a class="feature-link" href="/settings#providers">Explore connections ↗</a></article><article class="feature"><span class="number">03 / YOUR STYLE</span><h3>Make yourself at home.</h3><p>A quiet, carefully spaced interface. Familiar device fonts. Your choice of accent and background colors, saved to your account wherever you sign in.</p><a class="feature-link" href="/settings#appearance">Set your palette ↗</a></article></div></section><section class="closing"><div class="eyebrow" style="justify-content:center">A fresh perspective starts here</div><h2>Make space for your next chapter.</h2><p>Create your account, shape your workspace, and turn a list of possibilities into a plan you can follow.</p><a href="/signup" class="button">Begin with Delux crew <span aria-hidden="true">↗</span></a></section></main><div class="wrap">${footer()}</div>`;
  bindHeader();
}
function authPage(signup) {
  document.title = `${signup ? 'Create your workspace' : 'Welcome back'} — Delux crew`;
  app.innerHTML = `${header()}<main id="main" class="wrap auth"><section class="auth-story"><div class="eyebrow">A workspace with your name on it</div><h1>${signup ? 'Your next chapter,<br>beautifully organized.' : 'Welcome back.<br>Pick up your momentum.'}</h1><p>One place to track your work, connect your tools, and make every day feel a little more considered.</p><div class="auth-points"><div class="auth-point"><span>01</span> Your own workflow board and activity history</div><div class="auth-point"><span>02</span> OpenAI and WhatsApp connection settings</div><div class="auth-point"><span>03</span> A palette that feels like you</div></div></section><section class="auth-form-wrap"><h2>${signup ? 'Create your account' : 'Sign in to your workspace'}</h2><p>${signup ? 'A few details, then a fresh start.' : 'Your workflows and preferences are waiting.'}</p><form id="authForm" class="form">${signup ? '<div class="two-fields"><label class="field">Your name<input name="name" autocomplete="name" maxlength="80" required placeholder="How should we call you?"></label><label class="field">Workspace name<input name="workspace" autocomplete="organization" maxlength="80" required placeholder="Your studio or team"></label></div>' : ''}<label class="field">Email address<input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label><label class="field">Password<input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="10" maxlength="128" required placeholder="At least 10 characters"></label><div class="form-error" role="alert"></div><button class="button" type="submit">${signup ? 'Create workspace' : 'Sign in'} <span aria-hidden="true">↗</span></button><small>${signup ? 'Your account is stored on this Delux crew installation. Use a unique password. Email verification and password recovery are not available yet.' : 'Use the account you created on this installation. Need help? Contact Onesmus using the logo above.'}</small></form><p class="form-foot">${signup ? 'Already have an account? <a href="/login">Sign in</a>' : 'New to Delux crew? <a href="/signup">Create an account</a>'}</p></section></main>`;
  bindHeader();
  document.querySelector('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      button = form.querySelector('button');
    button.disabled = true;
    form.querySelector('.form-error').textContent = '';
    try {
      await api(signup ? 'signup' : 'login', 'POST', Object.fromEntries(new FormData(form)));
      location.assign(nextPath());
    } catch (err) {
      form.querySelector('.form-error').textContent = err.message;
      button.disabled = false;
    }
  });
}
const connectionState = (p) =>
  ({
    verified: 'Access verified',
    configured: 'Saved · verify access',
    error: 'Needs attention',
    disconnected: 'Not connected',
  })[p.status];
function providerChips() {
  return ['openai', 'whatsapp']
    .map(
      (id) =>
        `<a class="provider-chip" href="/settings#${id}"><span class="provider-mark" aria-hidden="true">${id === 'openai' ? '✳' : '◉'}</span>${providerNames[id]}<span>${connectionState(user.providers[id])}</span></a>`,
    )
    .join('');
}
async function loadWorkflows() {
  ({ workflows, activity } = await api('workflows'));
}
function workspace() {
  document.title = `${user.workspace} — Delux crew`;
  app.innerHTML = `${header(true)}<main id="main" class="wrap workspace"><div class="workspace-title"><div><div class="eyebrow">${esc(user.workspace)} / Your overview</div><h1>A little clarity, ${esc(user.name.split(' ')[0])}.</h1><p>Your plans, progress, and next steps — all in one place.</p></div><button class="button" id="newWorkflow">New workflow <span aria-hidden="true">＋</span></button></div><div class="stats" id="stats"></div><div class="workspace-providers">${providerChips()}</div><div class="toolbar"><h2>Your workflow board</h2><label class="sr-only" for="search">Search workflows</label><input class="search" id="search" type="search" placeholder="Search your workflows…"></div><div id="boardArea"></div><section class="activity" aria-labelledby="activityTitle"><h2 id="activityTitle">Recent activity</h2><div id="activityList"></div></section><p class="notice">This is your personal planning board. Changing stages or choosing a provider records your plan; it does not generate content or send messages. The <a href="/office" style="text-decoration:underline">3D office</a> is the installation’s shared agent environment.</p></main><dialog id="workflowDialog" class="dialog"></dialog>`;
  bindHeader();
  renderBoard();
  document.querySelector('#newWorkflow').onclick = () => editWorkflow();
  document.querySelector('#search').oninput = renderBoard;
}
function renderBoard() {
  const completed = workflows.filter((w) => w.stage === 'done').length;
  const counts = [
    workflows.length,
    workflows.filter((w) => w.stage === 'active').length,
    workflows.filter((w) => w.stage === 'review').length,
    completed,
  ];
  document.querySelector('#stats').innerHTML = ['Total workflows', 'In progress', 'Ready for review', 'Completed']
    .map((label, i) => `<div class="stat"><p>${label}</p><strong>${String(counts[i]).padStart(2, '0')}</strong></div>`)
    .join('');
  const query = document.querySelector('#search').value.toLowerCase().trim();
  const filtered = workflows.filter((w) =>
    `${w.title} ${w.description} ${departments[w.department]}`.toLowerCase().includes(query),
  );
  document.querySelector('#boardArea').innerHTML =
    `${!workflows.length ? '<div class="welcome"><h3>Your first idea belongs here.</h3><p>Create a workflow with a clear outcome. Add a department and due date, then update its stage as your work moves forward.</p></div>' : ''}${query ? `<p class="notice" role="status">${filtered.length} matching workflow${filtered.length === 1 ? '' : 's'}</p>` : ''}<div class="board">${Object.entries(
      stages,
    )
      .map(([stage, label]) => {
        const items = filtered.filter((w) => w.stage === stage);
        return `<section class="column"><h3>${label}<span>${items.length}</span></h3>${items.map((w) => `<button type="button" class="workflow-card" data-workflow="${w.id}" aria-label="Edit ${esc(w.title)}"><span class="pill">${departments[w.department]}</span><strong>${esc(w.title)}</strong>${w.description ? `<p>${esc(w.description)}</p>` : ''}<span class="card-meta"><span>${providerNames[w.provider]}</span><span>${w.due ? esc(w.due) : 'No due date'}</span></span></button>`).join('') || '<p class="empty-column">Room for your next step.</p>'}</section>`;
      })
      .join('')}</div>`;
  document
    .querySelectorAll('[data-workflow]')
    .forEach(
      (button) => (button.onclick = () => editWorkflow(workflows.find((w) => w.id === button.dataset.workflow))),
    );
  document.querySelector('#activityList').innerHTML = activity
    .slice(0, 8)
    .map(
      (item) =>
        `<div class="activity-row"><span>${esc(item.text)}</span><time datetime="${esc(item.at)}">${esc(new Date(item.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</time></div>`,
    )
    .join('');
}
function editWorkflow(workflow) {
  const dialog = document.querySelector('#workflowDialog');
  const w = workflow || { title: '', description: '', department: 'ops', stage: 'queued', provider: 'manual', due: '' };
  const options = (list, selected) =>
    Object.entries(list)
      .map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`)
      .join('');
  dialog.innerHTML = `<div class="dialog-top"><h2>${workflow ? 'Shape your workflow' : 'Start something new'}</h2><button class="close" type="button" aria-label="Close workflow">×</button></div><form class="form" id="workflowForm"><label class="field">Workflow title<input name="title" maxlength="160" required value="${esc(w.title)}" placeholder="What would you like to move forward?"></label><label class="field">Notes & desired outcome<textarea name="description" maxlength="2000" placeholder="A little context goes a long way…">${esc(w.description)}</textarea></label><div class="two-fields"><label class="field">Department<select name="department">${options(departments, w.department)}</select></label><label class="field">Stage<select name="stage">${options(stages, w.stage)}</select></label></div><div class="two-fields"><label class="field">Planned provider<select name="provider">${options({ openai: 'OpenAI', whatsapp: 'WhatsApp', manual: 'Manual / no provider' }, w.provider)}</select></label><label class="field">Due date (optional)<input type="date" name="due" value="${esc(w.due)}"></label></div><small>Provider selection is a planning label. Saving this workflow does not make an API request or send a message.</small><div class="form-error" role="alert"></div><div class="actions">${workflow ? '<button type="button" class="button danger small" id="deleteWorkflow">Delete workflow</button>' : '<button type="button" class="button secondary" id="cancelWorkflow">Cancel</button>'}<button type="submit" class="button">${workflow ? 'Save changes' : 'Create workflow'} ↗</button></div></form>`;
  dialog.querySelector('.close').onclick = () => dialog.close();
  dialog.querySelector('#cancelWorkflow')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('#deleteWorkflow')?.addEventListener('click', async (e) => {
    if (e.target.dataset.confirm !== 'yes') {
      e.target.dataset.confirm = 'yes';
      e.target.textContent = 'Confirm delete';
      return;
    }
    e.target.disabled = true;
    try {
      await api('workflows/' + w.id, 'DELETE');
      await loadWorkflows();
      renderBoard();
      dialog.close();
      toast('Workflow deleted.');
    } catch (err) {
      dialog.querySelector('.form-error').textContent = err.message;
      e.target.disabled = false;
    }
  });
  dialog.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      await api(
        'workflows' + (workflow ? '/' + w.id : ''),
        workflow ? 'PATCH' : 'POST',
        Object.fromEntries(new FormData(form)),
      );
      await loadWorkflows();
      renderBoard();
      dialog.close();
      toast(workflow ? 'Workflow updated.' : 'Your workflow is ready.');
    } catch (err) {
      form.querySelector('.form-error').textContent = err.message;
      button.disabled = false;
    }
  };
  dialog.showModal();
}
function providerSettings(id) {
  const p = user.providers[id],
    openai = id === 'openai';
  return `<section class="settings-section" id="${id}"><div class="section-label"><h2>${openai ? '✳ OpenAI' : '◉ WhatsApp'}</h2><span class="pill" id="${id}Status">${connectionState(p)}</span></div><p>${openai ? 'Connect your OpenAI API project. Verification reads your available models; it does not generate content.' : 'Connect a WhatsApp Business phone through Meta’s Cloud API. Verification reads phone details; it does not send messages.'} <a class="text-link" href="${openai ? 'https://platform.openai.com/api-keys' : 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started'}" target="_blank" rel="noopener noreferrer">Setup guide ↗</a></p><form class="form provider-form" data-provider="${id}">${openai ? '' : `<label class="field">WhatsApp Business phone number ID<input name="phoneId" inputmode="numeric" pattern="[0-9]+" maxlength="40" required value="${esc(p.phoneId)}" placeholder="Numeric ID from Meta, not your phone number"></label>`}<label class="field">${openai ? 'API key' : 'Access token'}<input name="secret" type="password" autocomplete="off" minlength="10" maxlength="4096" required placeholder="${p.configured ? 'Enter a new credential to replace the saved one' : openai ? 'Enter your OpenAI API key' : 'Enter your Meta access token'}"></label><div class="form-error" role="alert"></div><div class="actions"><button class="button small" type="submit">Save credentials</button><button class="button secondary small" type="button" data-verify="${id}" ${p.configured ? '' : 'disabled'}>Verify access</button><button class="button danger small" type="button" data-disconnect="${id}" ${p.configured ? '' : 'disabled'}>Disconnect</button></div></form><div class="provider-status" id="${id}Detail" aria-live="polite"><p>${esc(p.detail || 'No credentials saved yet.')}</p>${p.checkedAt ? `<p>Last checked: ${esc(new Date(p.checkedAt).toLocaleString())}</p>` : ''}</div></section>`;
}
function settings() {
  document.title = 'Settings — Delux crew';
  app.innerHTML = `${header(true)}<main id="main" class="wrap workspace"><div class="workspace-title"><div><div class="eyebrow">Make yourself at home</div><h1>Your workspace. Your way.</h1><p>Manage your profile, connect your providers, and find your palette.</p></div><a class="button secondary" href="/workspace">Back to workspace ↗</a></div><div class="settings-grid"><nav class="settings-nav" aria-label="Settings sections"><a href="#profile">Your profile</a><a href="#openai">OpenAI</a><a href="#whatsapp">WhatsApp</a><a href="#appearance">Appearance</a></nav><div class="settings-content"><section class="settings-section" id="profile"><h2>The personal details</h2><p>Your account and workflow data belong to this installation.</p><form id="profileForm" class="form"><div class="two-fields"><label class="field">Your name<input name="name" value="${esc(user.name)}" maxlength="80" required></label><label class="field">Workspace name<input name="workspace" value="${esc(user.workspace)}" maxlength="80" required></label></div><label class="field">Account email<input type="email" value="${esc(user.email)}" readonly></label><div class="form-error" role="alert"></div><div><button type="submit" class="button small">Save profile</button></div></form></section><div id="providers"><div class="eyebrow">Your service providers</div>${providerSettings('openai')}${providerSettings('whatsapp')}</div><section id="appearance" class="settings-section"><h2>A palette with personality</h2><p>Choose a starting point or make it your own. Text contrast adapts automatically. Saved colors follow your account across the workspace and office interface.</p><div class="swatches"><button type="button" class="swatch" data-preset="gold"><i style="background:#c5a572"></i>Evening gold</button><button type="button" class="swatch" data-preset="sage"><i style="background:#a9bf9d"></i>Quiet sage</button><button type="button" class="swatch" data-preset="ivory"><i style="background:#8a6036"></i>Warm ivory</button><button type="button" class="swatch" data-preset="violet"><i style="background:#b5a5e4"></i>After hours</button></div><form id="themeForm" class="form"><div class="two-fields"><label class="field">Accent color<input type="color" name="accent" value="${user.theme.accent}"></label><label class="field">Background color<input type="color" name="background" value="${user.theme.background}"></label></div><div class="theme-preview"><h3>Space for your best work.</h3><p>This is how your saved palette will feel. Preview changes below, then save when it feels right.</p><span class="button small">Your next step ↗</span></div><div class="form-error" role="alert"></div><div class="actions"><button type="submit" class="button small">Save colors</button><button type="button" class="button secondary small" id="revertTheme">Revert preview</button><button type="button" class="button secondary small" id="resetTheme">Default palette</button></div></form></section><p class="notice">Provider credentials are encrypted on this server and are never returned to your browser. A verified connection confirms API access at the time of the check. Workflow automation and message sending are not part of these connections yet.</p></div></div></main>`;
  bindHeader();
  const submitForm = (id, route, onSuccess) =>
    document.querySelector(id).addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        button = form.querySelector('[type=submit]');
      button.disabled = true;
      form.querySelector('.form-error').textContent = '';
      try {
        setUser((await api(route, 'PATCH', Object.fromEntries(new FormData(form)))).user);
        onSuccess();
      } catch (err) {
        form.querySelector('.form-error').textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
  submitForm('#profileForm', 'profile', () => toast('Profile saved.'));
  submitForm('#themeForm', 'theme', () => toast('Your colors are saved.'));
  const themeForm = document.querySelector('#themeForm');
  const preview = (colors) => {
    themeForm.elements.accent.value = colors.accent;
    themeForm.elements.background.value = colors.background;
    applyTheme(colors);
  };
  themeForm.addEventListener('input', () => applyTheme(Object.fromEntries(new FormData(themeForm))));
  const presets = {
    gold: defaultTheme,
    sage: { accent: '#a9bf9d', background: '#151c18' },
    ivory: { accent: '#8a6036', background: '#f5f1e8' },
    violet: { accent: '#b5a5e4', background: '#181521' },
  };
  document.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => preview(presets[b.dataset.preset])));
  document.querySelector('#revertTheme').onclick = () => preview(user.theme);
  document.querySelector('#resetTheme').onclick = () => preview(defaultTheme);
  function refreshProvider(id) {
    const p = user.providers[id];
    document.querySelector('#' + id + 'Status').textContent = connectionState(p);
    const detail = document.querySelector('#' + id + 'Detail');
    detail.replaceChildren();
    const message = document.createElement('p');
    message.textContent = p.detail || 'No credentials saved yet.';
    detail.append(message);
    if (p.checkedAt) {
      const checked = document.createElement('p');
      checked.textContent = 'Last checked: ' + new Date(p.checkedAt).toLocaleString();
      detail.append(checked);
    }
    for (const action of ['verify', 'disconnect'])
      document.querySelector(`[data-${action}="${id}"]`).disabled = !p.configured;
  }
  document.querySelectorAll('.provider-form').forEach((form) => {
    const id = form.dataset.provider;
    async function perform(action, body) {
      const buttons = [...form.querySelectorAll('button')];
      buttons.forEach((b) => (b.disabled = true));
      form.querySelector('.form-error').textContent = '';
      try {
        // Provider saves must not discard an unsaved color preview.
        user = (
          await api(
            'providers/' + id + (action === 'verify' ? '/verify' : ''),
            action === 'save' ? 'PATCH' : action === 'verify' ? 'POST' : 'DELETE',
            body,
          )
        ).user;
        if (action === 'save') form.elements.secret.value = '';
        if (action === 'disconnect') form.reset();
        toast(
          action === 'verify'
            ? connectionState(user.providers[id])
            : action === 'save'
              ? 'Credentials saved. You can now verify access.'
              : 'Provider disconnected.',
        );
      } catch (err) {
        form.querySelector('.form-error').textContent = err.message;
      } finally {
        buttons.forEach((b) => (b.disabled = false));
        refreshProvider(id);
      }
    }
    form.onsubmit = (e) => {
      e.preventDefault();
      perform('save', Object.fromEntries(new FormData(form)));
    };
    form.querySelector('[data-verify]').onclick = () => perform('verify');
    form.querySelector('[data-disconnect]').onclick = () => perform('disconnect');
  });
  if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
}
async function start() {
  const route = location.pathname;
  if (['/', '/index.html', '/luxury'].includes(route)) return landing();
  if (['/signup', '/login'].includes(route)) {
    authPage(route === '/signup');
    // Someone who already has a session should not be asked to sign in again —
    // send them on to where they were headed. Without this, opening /login from
    // the office (or pressing Back after signing in) shows the form a second time.
    try {
      setUser((await api('me')).user);
      location.replace(nextPath());
    } catch {
      // not signed in — the form above is the right place to be
    }
    return;
  }
  app.innerHTML = `${header()}<main id="main" class="wrap loading"><h1>A moment of clarity…</h1><p>Opening your workspace.</p></main>`;
  try {
    setUser((await api('me')).user);
    if (route === '/settings') settings();
    else {
      await loadWorkflows();
      workspace();
    }
  } catch (err) {
    if (err.status === 401) {
      // Come back to this page once they have signed in.
      location.replace('/login?next=' + encodeURIComponent(route));
      return;
    }
    app.innerHTML = `${header()}<main id="main" class="wrap loading"><h1>We couldn’t open your workspace.</h1><p>${esc(err.message)}</p><button class="button" id="retry">Try again</button></main>`;
    bindHeader();
    document.querySelector('#retry').onclick = () => location.reload();
  }
}
start();
