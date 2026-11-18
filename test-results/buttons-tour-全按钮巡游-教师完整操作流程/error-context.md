# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: buttons-tour.spec.ts >> 全按钮巡游:教师完整操作流程
- Location: tests/e2e/buttons-tour.spec.ts:9:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('#work-body tr')
Expected: 0
Received: 1
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" locator('#work-body tr') with timeout 5000ms
  - waiting for locator('#work-body tr')
    14 × locator resolved to 1 element
       - unexpected value "1"

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - banner [ref=e2]:
    - link "RatCVS 实验台首页" [ref=e3] [cursor=pointer]:
      - /url: ./
      - strong [ref=e5]: RatHeart-SimPro / 大鼠心血管实验台
    - generic [ref=e6]:
      - generic [ref=e7]: v0.2.0
      - button "使用说明" [ref=e8] [cursor=pointer]
      - button "原理与设置" [ref=e9] [cursor=pointer]
  - main [ref=e10]:
    - generic [ref=e11]:
      - complementary [ref=e12]:
        - generic [ref=e13]:
          - heading "动物模型" [level=2] [ref=e15]
          - button "新建实验" [ref=e16] [cursor=pointer]
          - generic "动物模型已锁定：点击「新建实验」后可重新选择" [ref=e17]:
            - generic [ref=e18]:
              - radio "去脑大鼠" [checked] [ref=e19]
              - text: 去脑大鼠
            - generic [ref=e20]:
              - radio "正常大鼠" [ref=e21]
              - text: 正常大鼠
          - paragraph [ref=e22]: 动物模型已锁定（记录开始后不可切换，与原版一致）。点击「新建实验」开始新实验后可重新选择模型。
        - generic [ref=e23]:
          - heading "给药注射" [level=2] [ref=e25]
          - generic "药物分组" [ref=e26]:
            - button "激动药" [ref=e27] [cursor=pointer]
            - button "拮抗 / 抑制药" [ref=e28] [cursor=pointer]
            - button "未知药" [ref=e29] [cursor=pointer]
          - generic [ref=e30]: 药物
          - combobox "药物" [ref=e31] [cursor=pointer]:
            - option "肾上腺素（Adr）" [selected]
            - option "去甲肾上腺素（Nor）"
            - option "异丙肾上腺素（Iso）"
            - option "去氧肾上腺素（Phe）"
            - option "乙酰胆碱（Ach）"
            - option "腺苷（Ade）"
            - option "克罗卡林（Cro）"
            - option "血管紧张素Ⅰ（An1）"
            - option "血管紧张素Ⅱ（An2）"
          - generic [ref=e32]: Adrenaline
          - paragraph [ref=e33]: 激动 α₁/β₁/β₂ 受体：低剂量以 β₂ 扩血管为主（血压可略降），高剂量 α₁ 缩血管占优（血压升高），心率始终加快。
          - generic [ref=e34]: 剂量
          - combobox "剂量" [ref=e35] [cursor=pointer]:
            - option "0.10 ug/kg" [selected]
            - option "0.2 ug/kg"
            - option "0.5 ug/kg"
            - option "1.00 ug/kg"
            - option "2.0 ug/kg"
            - option "5.0 ug/kg"
            - option "10.00 ug/kg"
            - option "20.0 ug/kg"
            - option "50.0 ug/kg"
            - option "100.00 ug/kg"
          - button "注射药物" [ref=e36] [cursor=pointer]
          - paragraph [ref=e37]: 药物注入静脉循环后血药浓度按一阶动力学衰减。
        - generic [ref=e38]:
          - heading "神经刺激" [level=2] [ref=e40]
          - generic [ref=e41]:
            - generic [ref=e42] [cursor=pointer]:
              - radio "交感神经（不含肾上腺）" [ref=e43]
              - text: 交感神经（不含肾上腺）
            - generic [ref=e44] [cursor=pointer]:
              - radio "交感神经（心脏支）" [ref=e45]
              - text: 交感神经（心脏支）
            - generic [ref=e46] [cursor=pointer]:
              - radio "交感神经（肾上腺支）" [ref=e47]
              - text: 交感神经（肾上腺支）
            - generic [ref=e48] [cursor=pointer]:
              - radio "肾神经" [ref=e49]
              - text: 肾神经
            - generic [ref=e50] [cursor=pointer]:
              - radio "迷走神经" [checked] [ref=e51]
              - text: 迷走神经
          - button "刺激神经" [ref=e52] [cursor=pointer]
          - paragraph [ref=e54]: 释放乙酰胆碱减慢心率，可被阿托品阻断
      - generic [ref=e55]:
        - generic [ref=e56]:
          - generic [ref=e57]:
            - generic [ref=e58]:
              - heading "血压与心率记录" [level=2] [ref=e59]
              - generic [ref=e60]:
                - generic [ref=e62]: 记录中
                - generic [ref=e63]: ·
                - generic [ref=e64]: 去脑大鼠
            - generic [ref=e65]:
              - generic [ref=e66]: 显示窗口
              - combobox "显示窗口" [ref=e67] [cursor=pointer]:
                - option "1.5 s"
                - option "3 s" [selected]
                - option "6 s"
                - option "12 s"
                - option "24 s"
                - option "48 s"
                - option "96 s"
                - option "全部记录"
              - button "×2" [ref=e68] [cursor=pointer]
              - button "÷2" [ref=e69] [cursor=pointer]
            - button "＋对比" [ref=e70] [cursor=pointer]
          - generic [ref=e71]:
            - generic [ref=e72]:
              - generic [ref=e73]: 平均动脉压
              - strong [ref=e74]: 86.4mmHg
            - generic [ref=e75]:
              - generic [ref=e76]: 心率
              - strong [ref=e77]: 351bpm
            - generic [ref=e78]:
              - generic [ref=e79]: 仿真时间
              - strong [ref=e80]: 00:31.9
            - generic [ref=e81]:
              - generic [ref=e82]: 最近一次操作
              - strong [ref=e83]: Pro 10 ug/kg
          - generic "动脉血压、心室内压与心率随时间变化的曲线" [ref=e85]
          - generic [ref=e86]:
            - generic [ref=e87]: ABP
            - generic [ref=e89]: LVP
            - generic [ref=e91]: VBP
            - generic [ref=e93]: HF
            - generic [ref=e95]: HR
            - generic [ref=e97]: 点击放测量光标 · 按住拖动框选区间均值
            - button "测量工作表" [ref=e98] [cursor=pointer]
          - generic [ref=e100]:
            - text: 对比 2
            - button "移除" [ref=e101] [cursor=pointer]: ×
          - generic [ref=e102]:
            - generic [ref=e103]: 回看时间
            - slider [ref=e104]: "5107"
            - button "回到最新" [ref=e105] [cursor=pointer]
          - generic [ref=e106]:
            - generic [ref=e107]:
              - button "暂停记录" [ref=e108] [cursor=pointer]
              - button "快进 30 s" [ref=e110] [cursor=pointer]
              - generic [ref=e111]:
                - generic [ref=e112]: 速度
                - combobox "速度" [ref=e113] [cursor=pointer]:
                  - option "0.25×" [selected]
                  - option "1×"
                  - option "2×"
                  - option "5×"
            - generic [ref=e114]:
              - button "导入实验" [ref=e115] [cursor=pointer]
              - group [ref=e116]:
                - generic "导出 ⌄" [ref=e117] [cursor=pointer]:
                  - text: 导出
                  - generic [ref=e118]: ⌄
            - button "开始授课广播" [ref=e119] [cursor=pointer]
        - generic [ref=e120]:
          - generic [ref=e121]:
            - heading "实验制备" [level=2] [ref=e123]
            - img "去脑大鼠制备示意图" [ref=e125]
            - paragraph [ref=e126]: 去脑大鼠制备：股动脉插管测动脉血压（ABP），左心室插管测心室内压（LVP），股静脉插管给药并测中心静脉压（VBP），HR 由脉搏间期计算，HF 为心收缩力。
          - generic [ref=e127]:
            - generic [ref=e128]:
              - heading "实验记录 (8)" [level=2] [ref=e129]:
                - text: 实验记录
                - generic [ref=e130]: (8)
              - button "查看循环药物" [ref=e131] [cursor=pointer]
              - button "量效曲线" [ref=e132] [cursor=pointer]
            - generic [ref=e133]:
              - generic [ref=e134]:
                - generic [ref=e135]: 00:00.3
                - generic [ref=e136]: Pro 10 ug/kg
              - generic [ref=e137]:
                - generic [ref=e138]: 00:00.2
                - generic [ref=e139]: Vagus Nv.
              - generic [ref=e140]:
                - generic [ref=e141]: 00:00.2
                - generic [ref=e142]: Renal Nv.
              - generic [ref=e143]:
                - generic [ref=e144]: 00:00.1
                - generic [ref=e145]: Symp.Nv.(adrenals)
              - generic [ref=e146]:
                - generic [ref=e147]: 00:00.1
                - generic [ref=e148]: Symp.Nv.(heart)
              - generic [ref=e149]:
                - generic [ref=e150]: 00:00.1
                - generic [ref=e151]: Symp.Nv.(blood ves.)
              - generic [ref=e152]:
                - generic [ref=e153]: 00:00.0
                - generic [ref=e154]: Adr 0.1 ug/kg
              - generic [ref=e155]:
                - generic [ref=e156]: 00:00.0
                - generic [ref=e157]: 新建实验 · 去脑大鼠
        - paragraph [ref=e158]:
          - generic [ref=e159]: 基于 RatCVS 3.3.7 教学模型 · 原模型 John Dempster, University of Strathclyde · 实验数据保存在当前浏览器。
  - dialog [ref=e160]:
    - generic [ref=e161]:
      - heading "测量工作表" [level=2] [ref=e163]
      - button "关闭" [ref=e164] [cursor=pointer]: ×
    - generic [ref=e165]:
      - paragraph [ref=e166]: 点击曲线放置绿色光标,再点「加入光标读数」逐行记录;点行尾 × 删除单行;导出 CSV 交作业或作图。
      - table [ref=e167]:
        - rowgroup [ref=e168]:
          - row [ref=e169]:
            - columnheader "#" [ref=e170]
            - columnheader "时间 s" [ref=e171]
            - columnheader "ABP" [ref=e172]
            - columnheader "LVP" [ref=e173]
            - columnheader "VBP" [ref=e174]
            - columnheader "HF" [ref=e175]
            - columnheader "HR" [ref=e176]
            - columnheader [ref=e177]
        - rowgroup [ref=e178]:
          - row [ref=e179]:
            - cell "暂无记录" [ref=e180]
      - generic [ref=e181]:
        - button "加入光标读数" [ref=e182] [cursor=pointer]
        - button "清空" [active] [ref=e183] [cursor=pointer]
        - button "导出 CSV" [ref=e184] [cursor=pointer]
  - status: 已保存「对比 2」——半透明叠加显示,可叠加多组对比给药前后
```

# Test source

```ts
  1   | // ============================================================
  2   | // 全按钮巡游 E2E:模拟教师一气呵成的真实操作,顺序点击全部按钮并断言。
  3   | // 单个大测试(状态连续):新建 → 记录 → 给药 → 刺激 → 对比叠加 →
  4   | // 量效曲线 → 工作表 → 设置 → 窗口 → 导出 → 导入 → 滑块 → 死亡 → 锁定 → 广播。
  5   | // 运行:npm run build && npx playwright test
  6   | // ============================================================
  7   | import { test, expect } from '@playwright/test';
  8   | 
  9   | test('全按钮巡游:教师完整操作流程', async ({ page }) => {
  10  |   test.setTimeout(180000);
  11  |   const errors: string[] = [];
  12  |   page.on('pageerror', e => errors.push(String(e)));
  13  |   page.on('dialog', d => d.accept());   // 所有 confirm 自动接受(等价人手点"确定")
  14  | 
  15  |   // 1. 加载 → 实验就绪
  16  |   await page.goto('/');
  17  |   await expect(page.locator('#recording-status')).toHaveText('实验就绪', { timeout: 8000 });
  18  | 
  19  |   console.error('[T]', '记录开始前', performance.now().toFixed(0));
  20  |   // 2. 开始记录 → 曲线渲染
  21  |   await page.click('#run-button');
  22  |   await expect(page.locator('#recording-status')).toContainText('记录中');
  23  |   await expect(page.locator('#plot-empty')).toBeHidden({ timeout: 3000 });
  24  | 
  25  |   // 3. 注射药物(激动药)
  26  |   await page.click('#inject-button');
  27  |   await expect(page.locator('#event-count')).toHaveText('2', { timeout: 3000 });
  28  |   await expect(page.locator('#last-operation')).toContainText('Adr');
  29  | 
  30  |   console.error('[T]', '给药后', performance.now().toFixed(0));
  31  |   // 4. 神经刺激:5 条通路逐一点击
  32  |   for (const value of ['symp_vessel', 'cardiac_symp', 'adrenal_symp', 'renal_nerve', 'vagus_nerve']) {
  33  |     await page.check(`input[name="nerve-pathway"][value="${value}"]`);
  34  |     await page.click('#stimulate-button');
  35  |     await page.waitForTimeout(120);
  36  |   }
  37  |   await expect(page.locator('#event-count')).toHaveText('7', { timeout: 3000 });
  38  | 
  39  |   // 5. 拮抗药页签 → 给药 → 恢复激动药
  40  |   await page.click('button[data-group="antagonist"]');
  41  |   await expect(page.locator('#drug-select')).toContainText('普萘洛尔');
  42  |   await page.click('#inject-button');
  43  |   await page.click('button[data-group="agonist"]');
  44  |   await expect(page.locator('#event-count')).toHaveText('8', { timeout: 3000 });
  45  | 
  46  |   console.error('[T]', '拮抗后', performance.now().toFixed(0));
  47  |   // 6. ＋对比:捕获两窗 → chips → 移除一窗
  48  |   await page.click('#overlay-capture');
  49  |   await expect(page.locator('.overlay-chip')).toHaveCount(1, { timeout: 3000 });
  50  |   await page.click('#overlay-capture');
  51  |   await expect(page.locator('.overlay-chip')).toHaveCount(2);
  52  |   await page.locator('.overlay-chip button').first().click();
  53  |   await expect(page.locator('.overlay-chip')).toHaveCount(1);
  54  | 
  55  |   console.error('[T]', '叠加后', performance.now().toFixed(0));
  56  |   // 7. 量效曲线对话框:先快进使给药后有足够反应数据,再打开
  57  |   await page.click('#advance-button');
  58  |   await page.waitForTimeout(1000);
  59  |   await page.click('#dose-tool-button');
  60  |   await expect(page.locator('#information-dialog')).toBeVisible();
  61  |   await expect(page.locator('#dose-canvas')).toBeVisible();
  62  |   // 第一行可能因给药后反应窗无数据被跳过,断言表格含任一给药药物行
  63  |   await expect(page.locator('.work-table tbody tr').first()).toContainText(/Adr|Pro|Dig/);
  64  |   await page.click('#close-dialog');
  65  |   await expect(page.locator('#information-dialog')).toBeHidden();
  66  | 
  67  |   console.error('[T]', '量效后', performance.now().toFixed(0));
  68  |   // 8. 测量工作表:点击曲线放光标 → 取数两行 → 清空 → 关闭
  69  |   await page.click('#worksheet-button');
  70  |   await expect(page.locator('#information-dialog')).toBeVisible();
  71  |   const cvBox = await page.locator('#trace-canvas').boundingBox();
  72  |   await page.mouse.click(cvBox.x + 300, cvBox.y + 80);
  73  |   await page.click('#work-add');
  74  |   await page.mouse.click(cvBox.x + 450, cvBox.y + 80);
  75  |   await page.click('#work-add');
  76  |   await expect(page.locator('#work-body tr')).toHaveCount(2);
  77  |   await page.click('#work-clear');
> 78  |   await expect(page.locator('#work-body tr')).toHaveCount(0);
      |                                               ^ Error: expect(locator).toHaveCount(expected) failed
  79  |   await page.click('#close-dialog');
  80  |   await expect(page.locator('#information-dialog')).toBeHidden();
  81  | 
  82  |   console.error('[T]', '工作表后', performance.now().toFixed(0));
  83  |   // 9. 原理与设置:噪声/拉平开关
  84  |   await page.click('#model-button');
  85  |   await expect(page.locator('#information-dialog')).toBeVisible();
  86  |   await page.click('#noise-toggle');
  87  |   await expect(page.locator('#noise-toggle')).not.toBeChecked();
  88  |   await page.click('#flatten-toggle');
  89  |   await expect(page.locator('#flatten-toggle')).toBeChecked();
  90  |   await page.click('#close-dialog');
  91  |   await page.click('#model-button');
  92  |   await page.click('#noise-toggle');
  93  |   await expect(page.locator('#noise-toggle')).toBeChecked();
  94  |   await page.click('#close-dialog');
  95  | 
  96  |   console.error('[T]', '设置后', performance.now().toFixed(0));
  97  |   // 10. 显示窗口:×2 / ÷2 / 全部记录 / 恢复(默认 3 s=480 样本)
  98  |   const sel = page.locator('#window-select');
  99  |   await page.click('#window-double');
  100 |   await expect(sel).toHaveValue('960');
  101 |   await page.click('#window-half');
  102 |   await expect(sel).toHaveValue('480');
  103 |   // 「全部记录」档必须真的绘制整条曲线:调试钩子核对绘制范围 == 全部帧
  104 |   await sel.selectOption('0');
  105 |   await expect(sel).toHaveValue('0');
  106 |   await page.waitForFunction(() => {
  107 |     const r = (window as any).__chartRange;
  108 |     return !!r && r.start === 0 && r.end === r.frames && r.frames > 480;
  109 |   }, undefined, { timeout: 3000 });
  110 |   await sel.selectOption('480');
  111 |   // 回到 3 s 窗口:只显示最近 480 帧
  112 |   await page.waitForFunction(() => {
  113 |     const r = (window as any).__chartRange;
  114 |     return !!r && r.start === r.end - 480 && r.end === r.frames;
  115 |   }, undefined, { timeout: 3000 });
  116 | 
  117 |   console.error('[T]', '窗口后', performance.now().toFixed(0));
  118 |   // 11. 导出:JSON / CSV / .rat / PNG 触发下载
  119 |   // 导出按钮藏在 <details class="export-menu"> 折叠菜单里,必须先展开
  120 |   // (否则按钮不可见,Playwright 点击会等待可见性直到超时)
  121 |   const openExportMenu = async () => {
  122 |     if (!await page.locator('.export-menu').evaluate(el => (el as HTMLDetailsElement).open)) {
  123 |       await page.click('.export-menu summary');
  124 |     }
  125 |   };
  126 |   await openExportMenu();
  127 |   for (const [btn, ext] of [['#save-button', '.json'], ['#csv-button', '.csv'], ['#png-button', '.png'], ['#rat-button', '.rat']] as const) {
  128 |     const dl = page.waitForEvent('download', { timeout: 20000 });
  129 |     await page.click(btn);
  130 |     const download = await dl;
  131 |     expect(download.suggestedFilename().endsWith(ext), download.suggestedFilename()).toBe(true);
  132 |   }
  133 | 
  134 |   console.error('[T]', '导出后', performance.now().toFixed(0));
  135 |   // 12. 导入实验:JSON 导入恢复(仍暂停)
  136 |   // 注意:setInputFiles 用裸路径时 File.name 是临时 UUID(无扩展名),
  137 |   // 应用会正确地走 .rat 分支并拒绝——必须显式携带真实文件名
  138 |   const dl2 = page.waitForEvent('download', { timeout: 20000 });
  139 |   await openExportMenu();
  140 |   await page.click('#save-button');
  141 |   const download2 = await dl2;
  142 |   const path = await download2.path();
  143 |   const { readFileSync } = await import('node:fs');
  144 |   await page.setInputFiles('#file-input', {
  145 |     name: download2.suggestedFilename(),
  146 |     mimeType: 'application/json',
  147 |     buffer: readFileSync(path!)
  148 |   });
  149 |   await expect(page.locator('#recording-status')).toContainText('已暂停', { timeout: 5000 });
  150 | 
  151 |   console.error('[T]', '导入后', performance.now().toFixed(0));
  152 |   // 13. 回看滑块:拖动 + 回到最新(录制帧已超窗口)
  153 |   const slider = page.locator('#history-position');
  154 |   await expect(page.locator('#history-scroll')).toBeVisible({ timeout: 5000 });
  155 |   const max = Number(await slider.getAttribute('max'));
  156 |   await slider.fill(String(Math.floor(max / 2)));
  157 |   await page.click('#latest-button');
  158 |   await expect(page.locator('#history-scroll')).toBeVisible();
  159 | 
  160 |   console.error('[T]', '滑块后', performance.now().toFixed(0));
  161 |   // 14. 地高辛 100 mg/kg → 快进 → 大鼠死亡
  162 |   await page.click('button[data-group="antagonist"]');
  163 |   const drugSel = page.locator('#drug-select');
  164 |   // 用 value 选择(label 是全角括号「地高辛（Dig）」,半角括号匹配不到会无限等待)
  165 |   await drugSel.selectOption('digoxin');
  166 |   const doseSel = page.locator('#dose-select');
  167 |   const lastIdx = (await doseSel.locator('option').count()) - 1;
  168 |   await doseSel.selectOption({ index: lastIdx });
  169 |   await page.click('#inject-button');
  170 |   for (let i = 0; i < 16; i++) {
  171 |     await page.click('#advance-button');
  172 |     const status = await page.locator('#recording-status').textContent();
  173 |     if (status?.includes('死亡')) break;
  174 |     await page.waitForTimeout(700);
  175 |   }
  176 |   await expect(page.locator('#recording-status')).toContainText('大鼠死亡', { timeout: 5000 });
  177 |   await expect(page.locator('#last-operation')).toContainText('Your rat has died');
  178 | 
```