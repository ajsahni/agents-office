import { applyTheme, defaultTheme } from './theme.js';
import { readJson } from './http.js';

// The glass control layer above the office: the profile sheet (every setting
// this system can actually write), the hex nav, and the header search.
//
// It talks only to endpoints that already exist — it adds no server surface:
//   GET   /api/account/me · /api/mcp · /api/health
//   PATCH /api/account/theme · /api/account/profile
//   POST  /api/account/logout
//
// Nothing here generates content or sends messages. Provider rows report the
// saved credential state; pairing itself stays in Claude Code (`claude mcp
// add`), which is where the agents get their tools from.

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const PRESETS = {
  gold: defaultTheme,
  sage: { accent: '#a9bf9d', background: '#151c18' },
  ivory: { accent: '#8a6036', background: '#f5f1e8' },
  violet: { accent: '#b5a5e4', background: '#181521' },
};

// Pairing recipes. The agents get tools from Claude Code, so a connector is
// added there; the office then shows it on the bar. n8n is the one people ask
// for most, so it is first.
// Signing in from the office returns you to the office, not to the portal's
// workflow board. The portal reads `next` and only follows same-site paths.
const SIGN_IN = '/login?next=%2Foffice';

const PAIRING = [
  { name: 'n8n', hint: 'n8n MCP server', cmd: 'claude mcp add n8n http://localhost:5678/mcp' },
  { name: 'Gmail', hint: 'Google, via Claude in Chrome or the Gmail server', cmd: 'claude mcp add gmail' },
  { name: 'Slack', hint: 'workspace events', cmd: 'claude mcp add slack' },
  { name: 'Notion', hint: 'pages and databases', cmd: 'claude mcp add notion' },
];

export function initTopbar() {
  const panel = document.getElementById('topSettings');
  const profileBtn = document.getElementById('topProfile');
  const hexBtn = document.getElementById('topHex');
  const hexnav = document.getElementById('hexnav');
  const search = document.getElementById('topSearch');
  if (!panel || !profileBtn) return { tick() {} };

  let user = null,
    mcp = null,
    health = null,
    opened = false;

  async function account(route, method = 'GET', body) {
    const res = await fetch('/api/account/' + route, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Delux-Request': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401) return null;
    return readJson(res, 'That did not save.');
  }

  async function load() {
    const [me, connectors, vital] = await Promise.all([
      account('me').catch(() => null),
      fetch('/api/mcp', { cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null),
      fetch('/api/health', { cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null),
    ]);
    if (me?.user) user = me.user;
    mcp = connectors;
    health = vital;
    return user;
  }

  /* ---------------------------------------------------------------- profile */
  function sectionAppearance() {
    if (!user) {
      return `<section class="gp-section"><h3>Appearance</h3><p class="gp-note">Sign in to save a palette to your account. Until then the office uses its own colours.</p><p><a class="gp-link" href="${SIGN_IN}">Sign in ↗</a></p></section>`;
    }
    const t = user.theme;
    return `<section class="gp-section" id="gpAppearance"><h3>Appearance</h3>
      <p class="gp-note">Four starting points, or your own two colours. Text contrast adapts so every label stays readable, and the palette follows your account into the 3D office.</p>
      <div class="gp-swatches">
        ${Object.entries(PRESETS)
          .map(
            ([key, colors]) =>
              `<button type="button" class="gp-swatch" data-preset="${key}"><i style="background:${colors.background}"></i><i style="background:${colors.accent}"></i>${key === 'gold' ? 'Evening gold' : key === 'sage' ? 'Quiet sage' : key === 'ivory' ? 'Warm ivory' : 'After hours'}</button>`,
          )
          .join('')}
      </div>
      <div class="gp-fields">
        <label class="gp-field"><span>Accent</span><input type="color" id="gpAccent" value="${esc(t.accent)}"></label>
        <label class="gp-field"><span>Background</span><input type="color" id="gpBackground" value="${esc(t.background)}"></label>
      </div>
      <div class="gp-actions"><button type="button" class="gp-save" id="gpSaveTheme">Save palette</button><button type="button" class="gp-ghost" id="gpResetTheme">Default</button></div>
      <p class="gp-status" id="gpThemeStatus" role="status"></p>
    </section>`;
  }

  function sectionProfile() {
    if (!user) return '';
    return `<section class="gp-section" id="gpProfile"><h3>Your profile</h3>
      <div class="gp-fields">
        <label class="gp-field wide"><span>Name</span><input id="gpName" maxlength="80" value="${esc(user.name)}"></label>
        <label class="gp-field wide"><span>Workspace</span><input id="gpWorkspace" maxlength="80" value="${esc(user.workspace)}"></label>
      </div>
      <div class="gp-actions"><button type="button" class="gp-save" id="gpSaveProfile">Save profile</button></div>
      <p class="gp-status" id="gpProfileStatus" role="status"></p>
    </section>`;
  }

  function sectionConnections() {
    const providers = user
      ? Object.entries(user.providers || {}).map(([id, p]) => {
          const name = id === 'openai' ? 'OpenAI' : id === 'whatsapp' ? 'WhatsApp' : id;
          const verified = p.status === 'verified';
          return `<li><span class="gp-dot" data-state="${esc(p.status)}"></span><b>${esc(name)}</b><em>${verified ? 'API access verified' : p.status === 'error' ? 'Check failed' : 'Not connected'}</em></li>`;
        })
      : [];
    const servers = (mcp?.servers || []).map((s) => {
      const state = s.state || s.status || 'connected';
      return `<li><span class="gp-dot" data-state="${state === 'connected' ? 'verified' : 'error'}"></span><b>${esc(s.name)}</b><em>${esc(state)}</em></li>`;
    });
    return `<section class="gp-section" id="gpPairing"><h3>Connections</h3>
      <p class="gp-note">The agents get their tools from Claude Code. Pair a server there and it appears on the bar — no credentials ever pass through this page.</p>
      ${
        providers.length
          ? `<ul class="gp-list">${providers.join('')}</ul>`
          : '<p class="gp-note">Sign in to see your saved provider connections.</p>'
      }
      <h4>Pair an MCP server</h4>
      <ul class="gp-list gp-pair">
        ${PAIRING.map((p) => `<li><b>${esc(p.name)}</b><em>${esc(p.hint)}</em><code>${esc(p.cmd)}</code></li>`).join(
          '',
        )}
      </ul>
      ${servers.length ? `<h4>On this machine</h4><ul class="gp-list">${servers.join('')}</ul>` : '<p class="gp-note">No MCP server is connected yet — run one of the commands above.</p>'}
      <p><a class="gp-link" href="/settings#providers">Open full settings ↗</a></p>
    </section>`;
  }

  function sectionLinks() {
    return `<section class="gp-section"><h3>Go</h3>
      <div class="gp-actions">
        <a class="gp-ghost" href="/workspace">Workspace</a>
        <a class="gp-ghost" href="/settings">Settings</a>
        ${user ? '<button type="button" class="gp-ghost" id="gpLogout">Sign out</button>' : `<a class="gp-ghost" href="${SIGN_IN}">Sign in</a>`}
      </div>
      <p class="gp-note">Office keys — B board · G brain · P calendar · 1–6 departments · D dark · V full screen · Esc back.</p>
    </section>`;
  }

  function render() {
    panel.innerHTML = `<div class="gp-head"><h2>Settings</h2><button type="button" class="gp-close" aria-label="Close settings">×</button></div>
      ${sectionAppearance()}
      ${sectionProfile()}
      ${sectionConnections()}
      ${sectionLinks()}`;
    panel.querySelector('.gp-close').onclick = () => close();
    bindAppearance();
    bindProfile();
    panel.querySelector('#gpLogout')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await account('logout', 'POST');
        location.assign(SIGN_IN);
      } catch (err) {
        status('gpThemeStatus', err.message);
      }
    });
  }

  function status(id, message, ok = true) {
    const node = panel.querySelector('#' + id);
    if (!node) return;
    node.textContent = message;
    node.dataset.ok = String(ok);
  }

  function bindAppearance() {
    const accent = panel.querySelector('#gpAccent');
    const background = panel.querySelector('#gpBackground');
    if (!accent || !background) return;
    const colors = () => ({ accent: accent.value, background: background.value });
    const preview = () => applyTheme(colors(), true); // live, in the office
    accent.addEventListener('input', preview);
    background.addEventListener('input', preview);
    panel.querySelectorAll('[data-preset]').forEach((b) => {
      b.onclick = () => {
        accent.value = PRESETS[b.dataset.preset].accent;
        background.value = PRESETS[b.dataset.preset].background;
        preview();
      };
    });
    panel.querySelector('#gpResetTheme').onclick = () => {
      accent.value = defaultTheme.accent;
      background.value = defaultTheme.background;
      preview();
    };
    panel.querySelector('#gpSaveTheme').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const saved = await account('theme', 'PATCH', colors());
        user = saved.user;
        status('gpThemeStatus', 'Palette saved to your account.');
      } catch (err) {
        status('gpThemeStatus', err.message, false);
      } finally {
        e.target.disabled = false;
      }
    };
  }

  function bindProfile() {
    const name = panel.querySelector('#gpName');
    const workspace = panel.querySelector('#gpWorkspace');
    if (!name || !workspace) return;
    panel.querySelector('#gpSaveProfile').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const saved = await account('profile', 'PATCH', { name: name.value, workspace: workspace.value });
        user = saved.user;
        status('gpProfileStatus', 'Profile saved.');
      } catch (err) {
        status('gpProfileStatus', err.message, false);
      } finally {
        e.target.disabled = false;
      }
    };
  }

  async function open(section) {
    profileBtn.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    if (!opened || section) {
      await load();
      render();
      opened = true;
    }
    if (section) {
      panel.querySelector('#' + section)?.scrollIntoView({ block: 'start' });
    }
    panel.querySelector('.gp-close')?.focus();
  }

  function close() {
    panel.hidden = true;
    profileBtn.setAttribute('aria-expanded', 'false');
    profileBtn.focus();
  }

  profileBtn.addEventListener('click', () => (panel.hidden ? open() : close()));
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || profileBtn.contains(e.target)) return;
    if (e.target.closest('[data-settings]')) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!panel.hidden) close();
  });
  document.querySelectorAll('[data-settings]').forEach((b) =>
    b.addEventListener('click', () => {
      open(b.dataset.settings === 'appearance' ? 'gpAppearance' : 'gpPairing');
    }),
  );

  /* ------------------------------------------------------------- hex nav */
  hexBtn?.addEventListener('click', () => {
    const shown = hexnav.hasAttribute('hidden');
    if (shown) hexnav.removeAttribute('hidden');
    else hexnav.setAttribute('hidden', '');
    hexBtn.classList.toggle('on', shown);
    hexBtn.setAttribute('aria-expanded', String(shown));
  });
  document.querySelectorAll('[data-office]').forEach((b) =>
    b.addEventListener('click', () => {
      const cc = window.CC || {};
      const what = b.dataset.office;
      if (what === 'board') cc.toggleBoard?.();
      else if (what === 'brain') cc.brain?.toggle();
      else if (what === 'calendar') cc.tasks?.calendar?.toggle();
    }),
  );

  /* -------------------------------------------------------------- search */
  if (search) {
    const list = document.createElement('datalist');
    list.id = 'topSearchList';
    search.setAttribute('list', list.id);
    search.after(list);

    const tiles = [...(hexnav?.querySelectorAll('.hex') || [])];
    const query = () => search.value.trim().toLowerCase();

    function places() {
      const fromNav = tiles
        .filter((t) => t.tagName === 'A' || t.dataset.office)
        .map((t) => ({
          label: t.textContent.trim(),
          run: () => (t.dataset.office ? t.click() : t.click()),
        }));
      const agents = (health?.agents || []).map((a) => ({
        label: `${a.name} — ${a.role || a.does || ''}`,
        run: () => window.CC?.openAgent?.(a.id),
      }));
      const notes = (health?.brain?.nodes || []).map((n) => ({
        label: `Note — ${n.id}`,
        run: () => window.CC?.brain?.open?.(),
      }));
      return [...fromNav, ...agents, ...notes];
    }

    function matches() {
      const q = query();
      if (!q) return [];
      return places()
        .filter((p) => p.label.toLowerCase().includes(q))
        .slice(0, 8);
    }

    function paint() {
      const q = query();
      tiles.forEach((t) => t.classList.toggle('dim', !!q && !t.textContent.toLowerCase().includes(q)));
      const hits = matches();
      list.replaceChildren(
        ...hits.map((h) => {
          const o = document.createElement('option');
          o.value = h.label;
          return o;
        }),
      );
      return hits;
    }

    search.addEventListener('input', paint);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        search.value = '';
        paint();
        search.blur();
        e.stopPropagation();
        return;
      }
      if (e.key !== 'Enter') return;
      e.stopPropagation(); // never let a department hotkey steal the field
      const hit = matches()[0];
      if (hit) {
        hit.run();
        search.value = '';
        paint();
        search.blur();
      }
    });
    search.addEventListener('focus', () => {
      if (!health) load();
    });
  }

  return { open, close, load };
}
