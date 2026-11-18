// ============================================================
// 测量工作表:取数 → 单行删除 → 序号重排 → CSV 仍可用
// ============================================================
import { test, expect } from '@playwright/test';

test('工作表单行删除', async ({ page }) => {
  test.setTimeout(90000);
  page.on('pageerror', e => console.log('[pageerror]', String(e).split('\n')[0]));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.click('#run-button');
  await page.waitForTimeout(6000);

  await page.click('#worksheet-button');
  const cv = await page.locator('#trace-canvas').boundingBox();
  // modal backdrop 拦截物理点击:先关对话框放光标,再开对话框取数
  const addAt = async (px: number) => {
    await page.click('#close-dialog');
    await page.mouse.click(cv!.x + px, cv!.y + 120);
    await page.click('#worksheet-button');
    await page.click('#work-add');
  };
  await addAt(500);
  await addAt(700);
  await addAt(900);
  await expect(page.locator('#work-body tr')).toHaveCount(3);

  // 删除第 2 行 → 剩 2 行,序号重排
  await page.locator('#work-body button.work-del').nth(1).click();
  await expect(page.locator('#work-body tr')).toHaveCount(2);
  await expect(page.locator('#work-body tr').first()).toContainText('1');
  await expect(page.locator('#work-body tr').nth(1)).toContainText('2');

  // CSV 导出仍可用(2 行数据)
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await page.click('#work-csv');
  const download = await dl;
  expect(download.suggestedFilename().endsWith('.csv')).toBe(true);
});
