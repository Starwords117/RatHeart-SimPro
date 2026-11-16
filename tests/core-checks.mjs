// ============================================================
// RatCVS Web 内核核验：
//  1) 确定性黄金参考值（seed=42, noise=false）
//  2) 与原版 .rat 记录对照的行为基线（去脑大鼠 ABP≈92/HR≈351/VBP≈7.6）
//  3) 药理行为：竞争拮抗、阻断、颤动、死亡
//  4) 剂量序列、标注、快照续算、.rat 导入导出
// 运行前先 npm run build（测试导入 dist/）。
// ============================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Experiment, SAMPLE_DT, CH_SCALE, DT, POINT_DT } from '../dist/core.js';
import { DRUGS, doseList, doseAnnotation, drugById } from '../dist/catalog.js';

const results = [];
const record = (name, passed, actual, expected) => { results.push({ name, passed, actual, expected }); };
const ok = (name, cond, actual = cond, expected = true) => record(name, !!cond, actual, expected);
const near = (name, actual, expected, tolerance = 1e-6) => record(name, Math.abs(actual - expected) <= tolerance, actual, expected);

const mean = (tr, k) => tr.reduce((a, f) => a + f[k], 0) / tr.length;

// ---------- 目录 ----------
record('目录：42 条药物且 ID 唯一（9 激动 + 14 拮抗 + 11 未知 + 8 内部）',
  new Set(DRUGS.map(d => d.id)).size === 42 && DRUGS.length === 42, DRUGS.length, 42);
record('目录：sourceIndex 与 RATMAIN.PAS 注册顺序一致',
  DRUGS.every((d, i) => d.sourceIndex === i) && DRUGS[0].id === 'adrenaline' && DRUGS[41].id === 'ang2_ace',
  DRUGS.map(d => d.sourceIndex).join(','), '0..41');
record('目录：未知药 A–K 对应原版答案表',
  drugById('drug_a').targets.mus === 5e-3 && drugById('drug_k').antagonist === true && drugById('drug_e').targets.nox === 15,
  'A=mus, K=antagonist, E=nox15', true);

// ---------- 常量 ----------
near('采样间隔 = 显示点/2（0.125ms×100/2）', SAMPLE_DT, 0.00625, 1e-12);
near('积分步长', DT, 0.000125, 1e-15);
near('显示点间隔', POINT_DT, 0.0125, 1e-12);

// ---------- 黄金参考值（seed=42, noise=false）----------
{
  const e = new Experiment(true, 42, false);
  e.advance(15);
  const tail = e.trace.slice(-800);
  near('去脑大鼠 15s 基线 ABP（对照 .rat 原版 ≈92.3）', mean(tail, 'abp'), 93.05891, 1e-4);
  near('去脑大鼠基线 HR（对照 .rat 原版 449ADC=351bpm）', mean(tail, 'hr'), 351, 1e-6);
  near('去脑大鼠基线 VBP（对照 .rat 原版 312ADC=7.62）', mean(tail, 'vbp'), 7.609949, 1e-4);
  near('去脑大鼠 LVP 峰', Math.max(...tail.map(f => f.lvp)), 121.13421, 1e-4);
  record('子样本数 = 生理秒 × 160', e.trace.length === 2400, e.trace.length, 2400);

  e.inject('noradrenaline', 0.01);
  e.advance(6);
  const seg = e.trace.slice(-960);
  near('Nor 10μg/kg 收缩峰（原版记录 199±抖动）', Math.max(...seg.map(f => f.abp)), 177.609636, 1e-4);
  e.advance(30);
  near('Nor 30s 后恢复基线', mean(e.trace.slice(-800), 'abp'), 92.99712, 1e-3);
}
{
  const n = new Experiment(false, 42, false);
  n.advance(15);
  const tail = n.trace.slice(-800);
  near('正常大鼠基线 ABP（压力感受器+基础交感）', mean(tail, 'abp'), 138.257689, 1e-4);
  near('正常大鼠基线 HR（迷走张力下调）', mean(tail, 'hr'), 231.360281, 1e-4);
}

// ---------- 与原版 .rat 记录对照的行为 ----------
{
  const e = new Experiment(true, 42, false);
  e.advance(15);
  e.inject('isoprenaline', 0.01);
  e.advance(8);
  const seg = e.trace.slice(-1280);
  ok('Iso 10μg/kg：HR 峰 ≈600+（原版 785ADC=613）', Math.max(...seg.map(f => f.hr)) > 550, Math.max(...seg.map(f => f.hr)));
  ok('Iso 10μg/kg：血压下降 ≥20 mmHg（原版 630→450ADC）', Math.min(...seg.map(f => f.abp)) < 70, Math.min(...seg.map(f => f.abp)));
}
{
  const e = new Experiment(true, 42, false);
  e.advance(15);
  e.inject('acetylcholine', 0.01);
  e.advance(8);
  const seg = e.trace.slice(-1280);
  ok('Ach 10μg/kg：降压（原版 630→398ADC）', Math.min(...seg.map(f => f.abp)) < 60, Math.min(...seg.map(f => f.abp)));
  ok('Ach 10μg/kg：心率下降（原版 449→377ADC）', Math.min(...seg.map(f => f.hr)) < 300, Math.min(...seg.map(f => f.hr)));
  e.inject('atropine', 2);
  e.advance(30);
  const pre = mean(e.trace.slice(-800), 'abp');
  e.inject('acetylcholine', 0.01);
  e.advance(8);
  const post = mean(e.trace.slice(-800), 'abp');
  ok('阿托品 2mg/kg 阻断 Ach 降压（原版 630→630ADC）', Math.abs(post - pre) < 6, post - pre);
}
{
  // 肾上腺素低/高剂量双相（V3.3.5 调参目标：5-10μg/kg 升压）
  const e = new Experiment(true, 42, false);
  e.advance(15);
  e.inject('adrenaline', 0.01);
  e.advance(8);
  const seg = e.trace.slice(-1280);
  ok('Adr 10μg/kg：净升压（V3.3.7 行为）', mean(seg, 'abp') > 95, mean(seg, 'abp'));
}
{
  const e = new Experiment(true, 42, false);
  e.advance(15);
  e.inject('angiotensin2', 0.005);
  e.advance(12);
  const seg = e.trace.slice(-1920);
  ok('An2 5μg/kg：峰值升压 >60 mmHg（原版 633→1139ADC）', Math.max(...seg.map(f => f.abp)) > 150, Math.max(...seg.map(f => f.abp)));
  near('An2 不影响心率（原版 449ADC 恒定）', mean(seg, 'hr'), 351, 2);
}
{
  const e = new Experiment(true, 42, false);
  e.advance(10);
  e.inject('losartan', 10);
  e.advance(30);
  const pre = mean(e.trace.slice(-800), 'abp');
  e.inject('angiotensin2', 0.005);
  e.advance(12);
  const post = mean(e.trace.slice(-960), 'abp');
  ok('氯沙坦降低基础血压（阻断 AngⅡ 张力，原版 630→500ADC）', pre < 85, pre);
  ok('氯沙坦部分阻断外源性 An2（原版 766ADC）', post < 130 && post > pre, post);
}
{
  // 卡托普利阻断 ACE→AngⅡ 张力；不影响外源性 An2
  const e = new Experiment(true, 42, false);
  e.advance(10);
  e.inject('captopril', 100);
  e.advance(40);
  const postCap = mean(e.trace.slice(-800), 'abp');
  ok('卡托普利降压（取消基础 AngⅡ 张力）', postCap < 85, postCap);
  e.inject('angiotensin2', 0.005);
  e.advance(12);
  ok('卡托普利不影响外源性 An2 升压', Math.max(...e.trace.slice(-960).map(f => f.abp)) > 130, true);
}
{
  // 交感神经刺激 + 酚妥拉明阻断
  const e = new Experiment(true, 42, false);
  e.advance(15);
  e.stimulate('symp_vessel');
  e.advance(8);
  const peak = Math.max(...e.trace.slice(-1280).map(f => f.abp));
  ok('血管交感刺激升压 >20 mmHg', peak > 112, peak);
  const e2 = new Experiment(true, 42, false);
  e2.advance(10);
  e2.inject('phentolamine', 2);
  e2.advance(30);
  e2.stimulate('symp_vessel');
  e2.advance(8);
  const peak2 = Math.max(...e2.trace.slice(-1280).map(f => f.abp));
  ok('酚妥拉明阻断交感刺激升压', peak2 < peak - 15, [peak, peak2]);
}
{
  // 地高辛：治疗量强心；过量颤动→射血停止→死亡
  const e = new Experiment(true, 42, false);
  e.advance(15);
  e.inject('digoxin', 0.5);
  e.advance(30);
  ok('地高辛 0.5mg/kg：不颤动、存活', e.state.fibrillation === 0 && !e.state.dead, [e.state.fibrillation, e.state.dead]);
  const e2 = new Experiment(true, 42, false);
  e2.advance(15);
  e2.inject('digoxin', 50);
  e2.advance(150);
  ok('地高辛 50mg/kg：颤动', e2.state.fibrillation > 0, e2.state.fibrillation);
  ok('地高辛过量：大鼠死亡（ABP<20 持续）', e2.state.dead, e2.state.dead);
}
{
  // L-NOARG 升压且不阻断硝酸甘油
  const e = new Experiment(true, 42, false);
  e.advance(10);
  e.inject('lnoarg', 100);
  e.advance(30);
  const postLno = mean(e.trace.slice(-800), 'abp');
  ok('L-NOARG 升压（抑制 NO 合酶）', postLno > 95, postLno);
  e.inject('glyceryltrinitrate', 10);
  e.advance(8);
  ok('硝酸甘油仍降压（NO 供体绕过 NOS）', Math.min(...e.trace.slice(-1280).map(f => f.abp)) < postLno - 10, true);
}
{
  // 正常大鼠压力感受器反射：升压药引起心率下降（反射性）
  const e = new Experiment(false, 42, false);
  e.advance(15);
  const hr0 = mean(e.trace.slice(-400), 'hr');
  e.inject('phenylephrine', 0.1);
  e.advance(8);
  const hr1 = mean(e.trace.slice(-400), 'hr');
  ok('正常大鼠：Phe 升压引起反射性心动过缓', hr1 < hr0 - 20, [hr0, hr1]);
}

// ---------- 剂量序列与标注 ----------
{
  const list = doseList(drugById('adrenaline'));
  record('Adr 剂量序列 1/2/5×10ⁿ（原版格式：1×两位小数、2×/5×一位小数）',
    list[0].label === '0.10 ug/kg' && list[1].label === '0.2 ug/kg' && list[2].label === '0.5 ug/kg' && list.at(-1).label === '100.00 ug/kg',
    [list[0].label, list[1].label, list[2].label, list.at(-1).label].join(' | '), true);
  const cap = doseList(drugById('captopril'));
  record('Captopril 剂量序列（mg/kg 显示）', cap[0].label === '1.00 mg/kg', cap[0].label, true);
  record('标注格式与原版一致（Dose<1 → ug/kg）',
    doseAnnotation(drugById('noradrenaline'), 0.01) === 'Nor 10 ug/kg' && doseAnnotation(drugById('losartan'), 10) === 'Los 10 mg/kg',
    [doseAnnotation(drugById('noradrenaline'), 0.01), doseAnnotation(drugById('losartan'), 10)].join(' | '), true);
}

// ---------- 快照续算 ----------
{
  const e = new Experiment(true, 7, true);
  e.advance(20);
  e.inject('adrenaline', 0.05);
  e.advance(10);
  const snapshot = e.exportSnapshot();
  const restored = new Experiment(true, 1, true);
  restored.restore(JSON.parse(JSON.stringify(snapshot)));
  restored.advance(5);
  e.advance(5);
  const a = JSON.stringify(e.trace.slice(-160).map(f => [f.t, f.abp, f.hr]));
  const b = JSON.stringify(restored.trace.slice(-160).map(f => [f.t, f.abp, f.hr]));
  record('快照恢复后逐点续算一致（含随机）', a === b, 'trace compare', true);
}

// ---------- .rat 导入（真实原版文件）----------
{
  const buf = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/vagus.rat'));
  const e = new Experiment(true, 42, false);
  const okImport = e.importRAT(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  record('导入原版 vagus.rat', okImport && e.trace.length === 3780, e.trace.length, 3780);
  const first = e.trace[0];
  const view = new DataView(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const firstAbpAdc = view.getInt16(20400, true);
  record('导入波形物理值（首点 = 文件首采样×标度）', Math.abs(first.abp - firstAbpAdc * CH_SCALE.abp) < 1e-9, first.abp, firstAbpAdc * CH_SCALE.abp);
  const hrTail = mean(e.trace.slice(-500), 'hr');
  record('导入 HR 均值合理（去脑基线 ≈351）', hrTail > 330 && hrTail < 370, hrTail, '330..370');
  record('导入标记（Vagus Nv. 等 3 个）', e.events.filter(ev => ev.kind === 'import').length === 3, e.events.length, 3);
  record('导入后 historyOnly', e.state.historyOnly === true, true, true);
  // 导出→再导入 完整往返
  const exported = e.exportRAT();
  const e2 = new Experiment(true, 42, false);
  record('导出 .rat 后重新导入点数一致', e2.importRAT(exported) && e2.trace.length === e.trace.length, e2.trace.length, e.trace.length);
  record('导出 .rat 标记往返一致',
    e2.events.filter(ev => ev.kind === 'import').length === 3,
    e2.events.length, 3);
  record('导出 .rat 波形一致（ABP 第 1000 点）',
    Math.abs(e2.trace[1000].abp - e.trace[1000].abp) < 0.05, e2.trace[1000].abp, e.trace[1000].abp);
}
{
  // 截断文件必须被拒绝
  const buf = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/vagus.rat'));
  const truncated = buf.slice(0, 20400 + 100);
  const e = new Experiment(true, 42, false);
  record('截断 .rat 被拒绝', e.importRAT(truncated.buffer.slice(truncated.byteOffset, truncated.byteOffset + truncated.byteLength)) === false, false, true);
}

// ---------- 死亡后曲线拉平开关 ----------
{
  const e = new Experiment(true, 42, false);
  e.advance(15);
  e.inject('digoxin', 100);
  e.advance(60);
  ok('地高辛致死(默认室颤行为)', e.state.dead && e.trace.at(-1).hr > 100, e.trace.at(-1).hr, '>100(室颤波形)');
  const on = new Experiment(true, 42, false);
  on.setFlattenAfterDeath(true);
  on.advance(15);
  on.inject('digoxin', 100);
  on.advance(60);
  const tail = on.trace.slice(-400);
  ok('死亡后拉平开关:LVP/HF/HR 全通道为 0',
    on.state.dead && tail.every(f => f.lvp === 0 && f.hf === 0 && f.hr === 0),
    'flat tail', true);
  on.setFlattenAfterDeath(false);
  on.advance(5);
  ok('拉平可实时关闭(恢复室颤波形)', on.trace.at(-1).hr > 100, on.trace.at(-1).hr, '>100');
}

// ---------- 原版缺陷复刻：心交感刺激注入肾上腺素 ----------
{
  const e = new Experiment(true, 42, false);
  e.advance(15);
  e.stimulate('cardiac_symp');
  e.advance(6);
  const seg = e.trace.slice(-960);
  const adrenalineOnly = new Experiment(true, 42, false);
  adrenalineOnly.advance(15);
  adrenalineOnly.inject('adrenaline', 5.0 * 3.5e-3 * 0.5);  // ≈ 5×β1potency×(0.5+0)
  adrenalineOnly.advance(6);
  record('心交感刺激 = 肾上腺素注入（iSympHeart 缺陷复刻）',
    Math.abs(Math.max(...seg.map(f => f.hr)) - Math.max(...adrenalineOnly.trace.slice(-960).map(f => f.hr))) < 1e-6,
    'HR peak compare', true);
}

// ---------- 汇总 ----------
const passed = results.filter(r => r.passed).length;
console.log(JSON.stringify({ checks: results.length, passed, failed: results.length - passed }, null, 0));
for (const r of results.filter(r => !r.passed)) console.error(`FAIL ${r.name}\n  actual=${JSON.stringify(r.actual)} expected=${JSON.stringify(r.expected)}`);
process.exitCode = passed === results.length ? 0 : 1;
