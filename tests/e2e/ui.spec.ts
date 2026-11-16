// ============================================================
// UI 端到端测试(headless):教师端核心流程冒烟
// 运行:npm run build && npm run test:ui(需 playwright chromium)
// ============================================================
import { test, expect } from '@playwright/test';

test('教师端:加载无错误 → 记录 → 给药 → 曲线渲染 → 事件标注', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/');
  await expect(page.locator('#recording-status')).toHaveText('实验就绪');

  await page.click('#run-button');
  await page.waitForTimeout(800);
  await expect(page.locator('#recording-status')).toContainText('记录中');

  await page.click('#inject-button');
  await page.waitForTimeout(600);
  await expect(page.locator('#event-count')).not.toHaveText('1');

  // 曲线已渲染(plot-empty 隐藏)
  await expect(page.locator('#plot-empty')).toBeHidden();

  // 对比快照按钮可用
  await page.click('#overlay-capture');
  await expect(page.locator('#overlay-chips')).not.toBeHidden();

  // 无未捕获异常
  expect(errors, 'page errors: ' + errors.join('; ')).toHaveLength(0);
});

test('跟随页:无房间参数时给出引导', async ({ page }) => {
  await page.goto('/follow.html');
  await expect(page.locator('#plot-empty')).toContainText('未指定跟随房间');
});

test('跟随页:带房间参数跟随教师广播', async ({ page, context }) => {
  // 教师页:记录 + 广播(房间号由教师页生成并持久化)——保持打开,不能导航离开
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('#run-button')!.click();
  });
  await page.click('#broadcast-button');
  await expect(page.locator('#broadcast-button')).toContainText('停止授课广播');
  const room = await page.evaluate(() => localStorage.getItem('ratheart-room'));
  expect(room, '教师应生成并持久化房间号').toBeTruthy();

  // 学生:新开页面带房间进入跟随页(帧渲染依赖教师端录制进度,由回放缓冲保证平滑)
  const student = await context.newPage();
  await student.goto(`/follow.html?room=${room}`);
  await expect(student.locator('#follow-status')).toContainText('实时跟随老师端', { timeout: 5000 });
  const err = await student.evaluate(() => (window as any).__followError ?? null);
  expect(err, '跟随页不应有未捕获异常').toBeNull();
});
