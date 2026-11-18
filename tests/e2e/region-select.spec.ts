// ============================================================
// 区域框选均值 e2e:拖动画框 → 均值面板 → 加入工作表
// ============================================================
import { test, expect } from '@playwright/test';

test('区域框选均值', async ({ page }) => {
  test.setTimeout(90000);
  page.on('pageerror', e => console.log('[pageerror]', String(e).split('\n')[0]));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.click('#run-button');
  await page.waitForTimeout(6000);   // 攒 4s+ 帧

  // 在曲线中部横向拖拽 200px 触发框选
  const cv = await page.locator('#trace-canvas').boundingBox();
  const y = cv!.y + cv!.height / 2;
  await page.mouse.move(cv!.x + 500, y);
  await page.mouse.down();
  await page.mouse.move(cv!.x + 700, y, { steps: 12 });
  await page.mouse.up();

  // 均值面板出现且含五通道行
  const tip = page.locator('#region-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('区间均值');
  for (const ch of ['ABP', 'LVP', 'VBP', 'HF', 'HR']) await expect(tip).toContainText(ch);

  // 加入工作表 → workRows 增加一行(再次打开工作表可见)
  await tip.locator('button[data-act="work"]').click();
  await expect(page.locator('#toast')).toContainText('已加入工作表', { timeout: 3000 });
  await page.click('#worksheet-button');
  await expect(page.locator('#work-body tr')).toHaveCount(1);

  // 复制按钮不抛错
  await page.click('#close-dialog');
  const tip2 = page.locator('#region-tooltip');
  if (await tip2.count() && await tip2.isVisible().catch(() => false)) {
    await tip2.locator('button[data-act="copy"]').click();
  }

  // 单击曲线 → 清除选区(面板隐藏)
  await page.mouse.click(cv!.x + 400, y);
  await expect(page.locator('#region-tooltip')).toBeHidden();
});
