// ============================================================
// 学生端到端核验:模拟学生浏览器完整跟随链路
// 先于教师进入等待态 → 教师开课自动挂接(迟到挂接,无需刷新) →
// 实时跟随并渲染曲线 → 教师停止回到等待态。
// 打 playwright webServer(serve.mjs);桌面版内嵌服务器同协议同语义。
// ============================================================
import { test, expect } from '@playwright/test';

test('学生浏览器:等待 → 教师开课自动挂接 → 跟随 → 停止 → 空态', async ({ page }) => {
  const ROOM = 'E2EVERIFY';
  // 1. 学生先打开跟随页(此时无广播 → 等待态;空房间不得误报实时跟随)
  await page.goto(`/follow.html?room=${ROOM}`);
  await expect(page.locator('#follow-status')).toContainText('等待', { timeout: 8000 });

  // 2. 模拟教师:与 worker 同协议推送(full + chunk)
  const push = async (type: string, seqOffset: number, frames: any[]) => {
    const res = await page.request.post('/api/broadcast', {
      data: { type, room: ROOM, token: 'e2e-token', seq: 10 + seqOffset, state: { running: true, time: 1.5, points: 120, tissue: 'pithed' }, frames, events: [{ t: 0.5, kind: 'dose', text: 'Adr 1 ug/kg' }] }
    });
    expect(res.ok()).toBeTruthy();
  };
  const mkFrames = (n: number, t0: number) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * 0.00625, abp: 90 + Math.sin(i / 5) * 20, lvp: 5 + (i % 10) * 8, vbp: 7.5, hf: 5 + (i % 8), hr: 350 }));
  await push('full', 0, mkFrames(60, 0));
  for (let b = 0; b < 3; b++) await push('chunk', b + 1, mkFrames(20, 0.375 + b * 0.125));

  // 3. 等待态学生自动挂接 → 实时跟随并渲染曲线(迟到挂接 ≤2s,无需刷新)
  await expect(page.locator('#follow-status')).toContainText('实时跟随', { timeout: 8000 });
  await expect(page.locator('#plot-empty')).toBeHidden({ timeout: 8000 });
  await page.waitForFunction(() => {
    const r = (globalThis as any).__chartRange;
    return !!r && r.frames >= 100;
  }, undefined, { timeout: 8000 });

  // 4. 教师停止 → 学生回到等待空态
  await page.request.post('/api/broadcast-off', { data: { room: ROOM, token: 'e2e-token' } });
  await expect(page.locator('#follow-status')).toContainText('等待', { timeout: 8000 });
});
