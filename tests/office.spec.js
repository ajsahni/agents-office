import { test, expect } from '@playwright/test';

// Flow suite over the REAL server + REAL 3D UI with a recorded fixture office
// (built in global-setup.js). No Claude sessions run here (OFFICE_NO_SESSIONS=1).

async function enterOffice(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.CC && Object.keys(window.CC.R).length > 0, { timeout: 15_000 });
  await page.waitForTimeout(1200); // SSE replay settles
}

async function openAgentSheet(page, id = 'demo', tab = 'chat') {
  await page.evaluate(([aid, t]) => window.CC.openAgent(aid, t), [id, tab]);
  await page.waitForSelector('#rail.agentOpen', { timeout: 10_000 });
  await page.waitForTimeout(1200); // focus flight
}

test('the office boots from config: departments, colours, hired + vacant', async ({ request }) => {
  const office = await (await request.get('/api/office')).json();
  expect(office.departments.map(d => d.name)).toEqual(['Operations', 'Research']);
  expect(office.departments[0].colours.chip).toBeTruthy();
  const ops = office.departments[0];
  expect(ops.agents).toEqual([{ id: 'demo', hired: true }, { id: 'ghost', hired: false }]);
  expect(office.brain).toBeNull();
});

test('badges render with real metrics and the approval counter shows', async ({ page }) => {
  await enterOffice(page);
  await expect(page.locator('.badge').filter({ hasText: 'OPERATIONS' })).toBeVisible();
  await expect(page.locator('.badge').filter({ hasText: 'OPERATIONS' })).toContainText('RUNS TODAY');
  await expect(page.locator('.badge').filter({ hasText: 'OPERATIONS' })).toContainText('1 WAITING APPROVAL');
  await expect(page.locator('#topAppr')).toBeVisible();
  await expect(page.locator('#tag')).toContainText('2 AGENTS · 2 DEPARTMENTS');
});

test('unhired roster desks render as vacant (pill + rail row)', async ({ page }) => {
  await enterOffice(page);
  await expect(page.locator('.pill.vacant')).toContainText('GHOST');
  await page.evaluate(() => window.CC.enterFocus(Object.keys(window.CC.deptRT)[0]));
  await page.waitForTimeout(1500);
  await expect(page.locator('#railRows .vacantRow')).toContainText('GHOST');
});

test('agent sheet opens chat-first with the replayed live stream', async ({ page }) => {
  await enterOffice(page);
  await openAgentSheet(page);
  await expect(page.locator('#mMsgs')).toContainText(/Reading|Writing|Proposal drafted/);
  await expect(page.locator('#mMsgs .m-file')).toContainText('proposal.md');
});

test('chat send round-trips through the server as a user_say event', async ({ page }) => {
  await enterOffice(page);
  await openAgentSheet(page);
  await page.fill('#mIn', 'hello from the flow suite');
  await page.click('#mSend');
  await expect(page.locator('#mMsgs .m-user')).toContainText('hello from the flow suite', { timeout: 10_000 });
});

test('pending approval renders in chat and approve settles it', async ({ page }) => {
  await enterOffice(page);
  await openAgentSheet(page);
  const card = page.locator('.m-appr').filter({ hasText: 'Ridgeline' });
  await expect(card).toContainText('needs your approval', { ignoreCase: true });
  await card.locator('.a-yes').click();
  await expect(card).toContainText('✓ Approved', { timeout: 10_000 });
  await expect(page.locator('#topAppr')).toBeHidden();
});

test('settings tab shows the burn readout and saves model to the manifest', async ({ page, request }) => {
  await enterOffice(page);
  await openAgentSheet(page, 'demo', 'settings');
  await page.click('#rail .mtabs button[data-tab="settings"]');
  await expect(page.locator('#setBurn')).toContainText('EST API VALUE');
  await expect(page.locator('#setBurn')).toContainText('$0.38');
  await page.selectOption('#setModel', 'opus');
  await page.click('#setSave');
  await expect(page.locator('#setMsg')).toContainText(/next session/i, { timeout: 10_000 });
  const { agents } = await (await request.get('/api/agents')).json();
  expect(agents.find(a => a.id === 'demo').session.model).toBe('opus');
});

test('hire endpoint creates the agent and fills the vacant desk', async ({ request }) => {
  const res = await request.post('/api/hire', {
    data: { NAME: 'ghost', DEPARTMENT: 'Operations', SCHEDULE: 'manual', MODEL: 'haiku', EFFORT: 'low', INSTRUCTIONS: 'Fixture hire — verify the wizard path.' },
  });
  const out = await res.json();
  expect(out.ok).toBe(true);
  const office = await (await request.get('/api/office')).json();
  expect(office.departments[0].agents).toEqual([{ id: 'demo', hired: true }, { id: 'ghost', hired: true }]);
});
