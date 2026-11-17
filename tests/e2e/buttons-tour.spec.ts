// ============================================================
// 全按钮巡游 E2E:模拟教师一气呵成的真实操作,顺序点击全部按钮并断言。
// 单个大测试(状态连续):新建 → 记录 → 给药 → 刺激 → 对比叠加 →
// 量效曲线 → 工作表 → 设置 → 窗口 → 导出 → 导入 → 滑块 → 死亡 → 锁定 → 广播。
// 运行:npm run build && npx playwright test
// ============================================================
import { test, expect } from '@playwright/test';

test('全按钮巡游:教师完整操作流程', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());   // 所有 confirm 自动接受(等价人手点"确定")

  // 1. 加载 → 实验就绪
  await page.goto('/');
  await expect(page.locator('#recording-status')).toHaveText('实验就绪', { timeout: 8000 });

  console.error('[T]', '记录开始前', performance.now().toFixed(0));
  // 2. 开始记录 → 曲线渲染
  await page.click('#run-button');
  await expect(page.locator('#recording-status')).toContainText('记录中');
  await expect(page.locator('#plot-empty')).toBeHidden({ timeout: 3000 });

  // 3. 注射药物(激动药)
  await page.click('#inject-button');
  await expect(page.locator('#event-count')).toHaveText('2', { timeout: 3000 });
  await expect(page.locator('#last-operation')).toContainText('Adr');

  console.error('[T]', '给药后', performance.now().toFixed(0));
  // 4. 神经刺激:5 条通路逐一点击
  for (const value of ['symp_vessel', 'cardiac_symp', 'adrenal_symp', 'renal_nerve', 'vagus_nerve']) {
    await page.check(`input[name="nerve-pathway"][value="${value}"]`);
    await page.click('#stimulate-button');
    await page.waitForTimeout(120);
  }
  await expect(page.locator('#event-count')).toHaveText('7', { timeout: 3000 });

  // 5. 拮抗药页签 → 给药 → 恢复激动药
  await page.click('button[data-group="antagonist"]');
  await expect(page.locator('#drug-select')).toContainText('普萘洛尔');
  await page.click('#inject-button');
  await page.click('button[data-group="agonist"]');
  await expect(page.locator('#event-count')).toHaveText('8', { timeout: 3000 });

  console.error('[T]', '拮抗后', performance.now().toFixed(0));
  // 6. ＋对比:捕获两窗 → chips → 移除一窗
  await page.click('#overlay-capture');
  await expect(page.locator('.overlay-chip')).toHaveCount(1, { timeout: 3000 });
  await page.click('#overlay-capture');
  await expect(page.locator('.overlay-chip')).toHaveCount(2);
  await page.locator('.overlay-chip button').first().click();
  await expect(page.locator('.overlay-chip')).toHaveCount(1);

  console.error('[T]', '叠加后', performance.now().toFixed(0));
  // 7. 量效曲线对话框:先快进使给药后有足够反应数据,再打开
  await page.click('#advance-button');
  await page.waitForTimeout(1000);
  await page.click('#dose-tool-button');
  await expect(page.locator('#information-dialog')).toBeVisible();
  await expect(page.locator('#dose-canvas')).toBeVisible();
  // 第一行可能因给药后反应窗无数据被跳过,断言表格含任一给药药物行
  await expect(page.locator('.work-table tbody tr').first()).toContainText(/Adr|Pro|Dig/);
  await page.click('#close-dialog');
  await expect(page.locator('#information-dialog')).toBeHidden();

  console.error('[T]', '量效后', performance.now().toFixed(0));
  // 8. 测量工作表:点击曲线放光标 → 取数两行 → 清空 → 关闭
  await page.click('#worksheet-button');
  await expect(page.locator('#information-dialog')).toBeVisible();
  const cvBox = await page.locator('#trace-canvas').boundingBox();
  await page.mouse.click(cvBox.x + 300, cvBox.y + 80);
  await page.click('#work-add');
  await page.mouse.click(cvBox.x + 450, cvBox.y + 80);
  await page.click('#work-add');
  await expect(page.locator('#work-body tr')).toHaveCount(2);
  await page.click('#work-clear');
  await expect(page.locator('#work-body tr')).toHaveCount(0);
  await page.click('#close-dialog');
  await expect(page.locator('#information-dialog')).toBeHidden();

  console.error('[T]', '工作表后', performance.now().toFixed(0));
  // 9. 原理与设置:噪声/拉平开关
  await page.click('#model-button');
  await expect(page.locator('#information-dialog')).toBeVisible();
  await page.click('#noise-toggle');
  await expect(page.locator('#noise-toggle')).not.toBeChecked();
  await page.click('#flatten-toggle');
  await expect(page.locator('#flatten-toggle')).toBeChecked();
  await page.click('#close-dialog');
  await page.click('#model-button');
  await page.click('#noise-toggle');
  await expect(page.locator('#noise-toggle')).toBeChecked();
  await page.click('#close-dialog');

  console.error('[T]', '设置后', performance.now().toFixed(0));
  // 10. 显示窗口:×2 / ÷2 / 全部记录 / 恢复
  const sel = page.locator('#window-select');
  await page.click('#window-double');
  await expect(sel).toHaveValue('8000');
  await page.click('#window-half');
  await expect(sel).toHaveValue('4000');
  await sel.selectOption('0');
  await expect(sel).toHaveValue('0');
  await sel.selectOption('4000');

  console.error('[T]', '窗口后', performance.now().toFixed(0));
  // 11. 导出:JSON / CSV / .rat / PNG 触发下载
  // 导出按钮藏在 <details class="export-menu"> 折叠菜单里,必须先展开
  // (否则按钮不可见,Playwright 点击会等待可见性直到超时)
  const openExportMenu = async () => {
    if (!await page.locator('.export-menu').evaluate(el => (el as HTMLDetailsElement).open)) {
      await page.click('.export-menu summary');
    }
  };
  await openExportMenu();
  for (const [btn, ext] of [['#save-button', '.json'], ['#csv-button', '.csv'], ['#png-button', '.png'], ['#rat-button', '.rat']] as const) {
    const dl = page.waitForEvent('download', { timeout: 20000 });
    await page.click(btn);
    const download = await dl;
    expect(download.suggestedFilename().endsWith(ext), download.suggestedFilename()).toBe(true);
  }

  console.error('[T]', '导出后', performance.now().toFixed(0));
  // 12. 导入实验:JSON 导入恢复(仍暂停)
  // 注意:setInputFiles 用裸路径时 File.name 是临时 UUID(无扩展名),
  // 应用会正确地走 .rat 分支并拒绝——必须显式携带真实文件名
  const dl2 = page.waitForEvent('download', { timeout: 20000 });
  await openExportMenu();
  await page.click('#save-button');
  const download2 = await dl2;
  const path = await download2.path();
  const { readFileSync } = await import('node:fs');
  await page.setInputFiles('#file-input', {
    name: download2.suggestedFilename(),
    mimeType: 'application/json',
    buffer: readFileSync(path!)
  });
  await expect(page.locator('#recording-status')).toContainText('已暂停', { timeout: 5000 });

  console.error('[T]', '导入后', performance.now().toFixed(0));
  // 13. 回看滑块:拖动 + 回到最新(录制帧已超窗口)
  const slider = page.locator('#history-position');
  await expect(page.locator('#history-scroll')).toBeVisible({ timeout: 5000 });
  const max = Number(await slider.getAttribute('max'));
  await slider.fill(String(Math.floor(max / 2)));
  await page.click('#latest-button');
  await expect(page.locator('#history-scroll')).toBeVisible();

  console.error('[T]', '滑块后', performance.now().toFixed(0));
  // 14. 地高辛 100 mg/kg → 快进 → 大鼠死亡
  await page.click('button[data-group="antagonist"]');
  const drugSel = page.locator('#drug-select');
  // 用 value 选择(label 是全角括号「地高辛（Dig）」,半角括号匹配不到会无限等待)
  await drugSel.selectOption('digoxin');
  const doseSel = page.locator('#dose-select');
  const lastIdx = (await doseSel.locator('option').count()) - 1;
  await doseSel.selectOption({ index: lastIdx });
  await page.click('#inject-button');
  for (let i = 0; i < 16; i++) {
    await page.click('#advance-button');
    const status = await page.locator('#recording-status').textContent();
    if (status?.includes('死亡')) break;
    await page.waitForTimeout(700);
  }
  await expect(page.locator('#recording-status')).toContainText('大鼠死亡', { timeout: 5000 });
  await expect(page.locator('#last-operation')).toContainText('Your rat has died');

  console.error('[T]', '死亡后', performance.now().toFixed(0));
  // 15. 死亡后:模型锁定(点击不切换;不能用 page.check——它要求选中状态成立)
  await page.click('input[name="rat-model"][value="normal"]');
  await expect(page.locator('#toast')).toContainText('动物模型已锁定', { timeout: 3000 });
  await expect(page.locator('input[name="rat-model"][value="normal"]')).not.toBeChecked();
  await expect(page.locator('#chart-model')).toHaveText('去脑大鼠');

  // 16. 开始授课广播 → 停止(按钮翻转)
  await page.click('#broadcast-button');
  await expect(page.locator('#broadcast-button')).toContainText('停止授课广播', { timeout: 5000 });
  await page.click('#broadcast-button');
  await expect(page.locator('#broadcast-button')).toContainText('开始授课广播', { timeout: 5000 });

  // 17. 使用说明 / 原理与设置 对话框开关
  await page.click('#help-button');
  await expect(page.locator('#information-dialog')).toBeVisible();
  await page.click('#close-dialog');
  await page.click('#model-button');
  await expect(page.locator('#information-dialog')).toBeVisible();
  await page.click('#close-dialog');

  // 全程无未捕获异常
  expect(errors, '页面异常: ' + errors.join('; ')).toHaveLength(0);
});
