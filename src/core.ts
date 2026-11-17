// ============================================================
// RatCVS 心血管系统仿真内核 —— 移植自 RATMAIN.PAS (V3.3.7)
// 四元素集总参数模型：Heart / Art / Ven + 收缩力记录(Con)，
// 两个单向阀（心→动脉、静脉→心）。积分步长 0.125 ms，
// 每显示点 100 步；受体与药物动力学每 5 ms 更新一次。
// ============================================================

import { DRUGS, drugById, doseAnnotation } from './catalog.js';
import type { DrugDefinition, TargetId } from './catalog.js';

export const DT = 0.000125;                 // 原版 t.Step
export const STEPS_PER_POINT = 100;         // 原版 NumStepsPerDisplayPoint
export const POINT_DT = DT * STEPS_PER_POINT;
export const RECEPTOR_DT = 0.005;           // 原版 t.next 步进
export const MODEL_VERSION = 'ratheart-simpro-0.2.0'; // 模型移植自 RatCVS 3.3.7 (30.07.20)
/** 原版默认回放速度：TTimer.Interval=50ms → 20 显示点/s，
 *  每点 12.5 ms 生理时间 → 0.25 生理秒/实际秒。 */
export const DEFAULT_SPEED = 0.25;
/** 原版默认显示窗口（子样本数；每个显示点写 2 个子样本） */
export const DEFAULT_WINDOW_POINTS = 4000;
/** 子样本间隔（生理秒）：每显示点 2 个子样本 */
export const SAMPLE_DT = POINT_DT / 2;
/** 原版 ADC 标度：物理量 = ADC 值 × CH_SCALE */
export const CH_SCALE: Record<ChannelId, number> = {
  abp: 300 / 2047, lvp: 300 / 2047, vbp: 50 / 2047, hf: 20 / 2047, hr: 1600 / 2047
};

export const CH = ['abp', 'lvp', 'vbp', 'hf', 'hr'] as const;
export type ChannelId = typeof CH[number];

export interface Frame { t: number; abp: number; lvp: number; vbp: number; hf: number; hr: number; }
export interface ExperimentEvent { t: number; kind: string; text: string; }

export interface ElementState {
  conductance: number;
  elastance: number;
  volume: number;
  volume0: number;
  pressure: number;
  flow: number;
  /** 每搏动脉压极值（仅 Art 使用） */
  minP: number;
  maxP: number;
  meanP: number;
  /** 显示点内的压力极值追踪（leading/trailing 波形） */
  pressureLo: number;
  pressureHi: number;
  tLo: number;
  tHi: number;
}

export interface HeartState extends ElementState {
  rate: number;
  force: number;
  /** 收缩剩余时间（s）；>0 表示处于收缩期 */
  time: number;
  tsystole: number;
  nextBeat: number;
}

export interface SessionState {
  pithed: boolean;
  /** 记录开始后锁定动物模型切换（原版 gpExperimentType 行为） */
  recorderStarted: boolean;
  /** 导入历史 .rat 后只读回看 */
  historyOnly: boolean;
  /** 死亡后全通道拉平(教学可选,偏离原版室颤行为) */
  flattenAfterDeath: boolean;
  time: number;
  points: number;
  running: boolean;
  speed: number;
  noise: boolean;
  seed: number;
  rng: number;
  /** 受体/药物动力学的下一次更新时刻（原版 t.next） */
  receptorNext: number;
  dead: boolean;
  dying: number;
  fibrillation: number;
  doses: Record<string, { dose: number; injected: number }>;
  potencies: Record<string, Partial<Record<TargetId, number>>>;
  receptors: Partial<Record<TargetId, number>>;
  heart: HeartState;
  art: ElementState;
  ven: ElementState;
  /** 收缩力通道（Con）：记录心弹性曲线 */
  conPressure: number;
  conLo: number;
  conHi: number;
  conTLo: number;
  conTHi: number;
}

export interface Snapshot {
  format: 'ratheart-simpro';
  version: 1;
  modelVersion: string;
  savedAt: string;
  state: SessionState;
  trace: Frame[];
  events: ExperimentEvent[];
}

export interface Dose { drugId: string; dose: number; }

// 原版 TElement.InitialisePressureRange
const NEG_HUGE = -1e38;
const POS_HUGE = 1e38;

function newElement(volume0: number, volume: number, conductance: number, elastance: number): ElementState {
  return { conductance, elastance, volume, volume0, pressure: 0, flow: 0, minP: 0, maxP: 0, meanP: 0, pressureLo: POS_HUGE, pressureHi: NEG_HUGE, tLo: 0, tHi: 0 };
}

function newHeart(): HeartState {
  return {
    ...newElement(5, 10, 2500, 1 / 30),
    rate: 400, force: 0, time: 0, tsystole: 0, nextBeat: 0
  };
}

export class Experiment {
  state!: SessionState;
  trace: Frame[] = [];
  events: ExperimentEvent[] = [];

  constructor(pithed = true, seed = 20261031, noise = true) {
    this.reset(pithed, seed, noise);
  }

  // 可记录种子的 PRNG（mulberry32）。原版 Delphi RTL 的 LCG 序列不同，
  // 这是与原版的明确差异（与 OBSIM Web 重写同一处理）。
  random(): number {
    this.state.rng = (this.state.rng + 0x6D2B79F5) >>> 0;
    let t = this.state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 原版 AddNoise：1 ± Proportion 的均匀随机系数 */
  addNoise(proportion: number): number {
    return 1 + (2 * this.random() - 1) * proportion;
  }

  reset(pithed = this.state?.pithed ?? true, seed = this.state?.seed ?? 20261031, noise = this.state?.noise ?? true): void {
    this.state = {
      pithed, recorderStarted: false, historyOnly: false, flattenAfterDeath: false,
      time: 0, points: 0, running: false, speed: DEFAULT_SPEED,
      noise, seed, rng: seed >>> 0, receptorNext: -1,
      dead: false, dying: 0, fibrillation: 0,
      doses: {}, potencies: {}, receptors: {},
      heart: newHeart(),
      art: newElement(100, 150, 0.05, 1 / 0.8),
      ven: newElement(300, 600, 5000, 1 / 30),
      conPressure: 0, conLo: POS_HUGE, conHi: NEG_HUGE, conTLo: 0, conTHi: 0
    };
    // 药物剂量清零；效力参数按原版 SetAgonistPotency/SetAntagonistPotency
    // 的 AddNoise(0.5) 抖动（noise=false 时保持名义值）
    for (const d of DRUGS) {
      this.state.doses[d.id] = { dose: 0, injected: 0 };
      const potencies: Partial<Record<TargetId, number>> = {};
      for (const [target, base] of Object.entries(d.targets)) {
        potencies[target as TargetId] = noise ? base * this.addNoise(0.5) : base;
      }
      this.state.potencies[d.id] = potencies;
    }
    this.trace = [];
    this.events = [{ t: 0, kind: 'new', text: `新建实验 · ${pithed ? '去脑大鼠' : '正常大鼠'}` }];
  }

  addEvent(kind: string, text: string): void {
    this.events.push({ t: this.state.time, kind, text });
  }

  potency(drugId: string, target: TargetId): number {
    return this.state.potencies[drugId]?.[target] ?? 1e30;
  }

  // ------------------------------------------------------------------
  // 竞争性受体激活（原版 ReceptorActivation）：
  //   x = Dose / (Potency × PotencyShift)
  //   激活量 = Σ(效能ᵢ·xᵢ) / (1 + Σxᵢ)
  // 拮抗药效能 0（只进入分母）；所有药物共用同一受体池。
  // ------------------------------------------------------------------
  private receptorSum(target: TargetId, shift: number): { num: number; den: number } {
    let num = 0, den = 1;
    if (shift <= 0) shift = 1e-9;
    for (const d of DRUGS) {
      const potency = this.state.potencies[d.id][target];
      if (potency === undefined) continue;
      const x = this.state.doses[d.id].dose / (potency * shift);
      den += x;
      if (!d.antagonist) num += x;
    }
    return { num, den };
  }

  activation(target: TargetId, shift = 1): number {
    const { num, den } = this.receptorSum(target, shift);
    return den > 0 ? num / den : 0;
  }

  // ------------------------------------------------------------------
  // 给药（原版 bAddAgonist/bAddAntagonist/bAddUnknownClick）
  // ------------------------------------------------------------------
  inject(drugId: string, dose: number): void {
    const drug = drugById(drugId);
    const jitter = this.state.noise ? this.addNoise(0.1) : 1;
    this.state.doses[drugId].injected = dose * jitter;
    this.addEvent('dose', doseAnnotation(drug, dose));
  }

  // ------------------------------------------------------------------
  // 神经刺激（原版 bStimulationOnClick，5 条通路）
  // ------------------------------------------------------------------
  stimulate(pathwayId: string): void {
    const s = this.state;
    const alpha2 = s.receptors.alpha2 ?? 0;
    let text = '';
    switch (pathwayId) {
      case 'symp_vessel':
        s.doses.symp_vessel.injected = 4.0 * this.potency('symp_vessel', 'beta1') * (0.5 + alpha2);
        text = 'Symp.Nv.(blood ves.)';
        break;
      case 'cardiac_symp':
        // 原版缺陷复刻：iSympHeart 从未赋值（恒 0）→ 实际注入 Drugs[0]（肾上腺素）
        s.doses.adrenaline.injected = 5.0 * this.potency('adrenaline', 'beta1') * (0.5 + alpha2);
        text = 'Symp.Nv.(heart)';
        break;
      case 'adrenal_symp':
        s.doses.adrenal_symp.injected = 2.0 * this.potency('adrenal_symp', 'beta1');
        text = 'Symp.Nv.(adrenals)';
        break;
      case 'renal_nerve':
        s.doses.renal_nerve.injected = 5.0 * this.potency('renal_nerve', 'angt1');
        text = 'Renal Nv.';
        break;
      case 'vagus_nerve':
        s.doses.vagus_nerve.injected = 10.0 * this.potency('vagus_nerve', 'vag');
        text = 'Vagus Nv.';
        break;
      default:
        return;
    }
    this.addEvent('stimulus', text);
  }

  setPithed(pithed: boolean): void {
    if (this.state.recorderStarted) return;
    if (this.state.pithed === pithed) return;
    this.state.pithed = pithed;
    this.addEvent('model', pithed ? '切换为去脑大鼠模型' : '切换为正常大鼠模型');
  }

  setNoise(noise: boolean): void {
    this.state.noise = noise;
    this.addEvent('setting', noise ? '开启给药波动与记录噪声' : '关闭给药波动与记录噪声（当前药物效力不变）');
  }

  setFlattenAfterDeath(v: boolean): void {
    this.state.flattenAfterDeath = v;
    this.addEvent('setting', v ? '开启死亡后曲线拉平（偏离原版室颤行为）' : '关闭死亡后曲线拉平（恢复原版室颤行为）');
  }

  // ------------------------------------------------------------------
  // 受体与药物动力学更新（原版 CalculateTrace 的 t.next 块，每 5 ms）
  // ------------------------------------------------------------------
  private updateReceptors(): void {
    const s = this.state;
    const R = s.receptors;
    const D = s.doses;

    // 静息肾神经→血管紧张素Ⅰ 张力（原版 Max(Dose, Potency*0.25)）
    D.renal_nerve.dose = Math.max(D.renal_nerve.dose, this.potency('renal_nerve', 'angt1') * 0.25);

    // 尼古丁（神经节）激活（原版计算后仅保留，未进入效应方程）
    R.nic = this.activation('nic');

    // 正常大鼠：基础交感张力 + 压力感受器反馈（迷走）
    if (!s.pithed) {
      D.alpha1_nerve.dose = this.potency('alpha1_nerve', 'alpha1') * 0.4;
      D.beta1_nerve.dose = this.potency('beta1_nerve', 'beta1') * 0.2;
      const vagalDrive = 5.0 / (1 + Math.exp(-(s.art.meanP - 130) / 8));
      D.vagus_nerve.dose = Math.max(D.vagus_nerve.dose, this.potency('vagus_nerve', 'vag') * vagalDrive);
    }

    // 药物动力学（原版 UpdateCirculatingDrug 内联循环）
    for (const d of DRUGS) {
      const entry = D[d.id];
      entry.dose = entry.dose + d.onRate * (entry.injected - entry.dose) - entry.dose * d.removalRate;
      entry.dose = Math.max(entry.dose, 0);
      entry.injected = Math.max(entry.injected - entry.injected * d.removalRate, 0);
    }

    R.mus = this.activation('mus');
    R.vag = this.activation('vag');
    R.pde = this.activation('pde');
    R.alpha1 = this.activation('alpha1');
    R.alpha2 = this.activation('alpha2');
    const betaShift = 1.0 - (R.pde ?? 0) * 0.5;   // PDE 抑制增强 β 效应
    R.beta1 = this.activation('beta1', betaShift);
    R.beta2 = this.activation('beta2', betaShift);
    R.hmca = this.activation('hmca');
    R.dig = this.activation('dig');
    R.smca = this.activation('smca');
    R.aden = this.activation('aden');
    R.kch = this.activation('kch');
    R.nos = this.activation('nos');
    R.nox = this.activation('nox');
    R.angt1 = this.activation('angt1');
    R.ace = this.activation('ace');

    // ACE 实时生成的血管紧张素Ⅱ（原版对 iAngioTensin2ACE 的赋值）
    const angt1Act = R.angt1 ?? 0;
    D.ang2_ace.dose = this.potency('ang2_ace', 'angt2') * 5.0 * (1.0 - (R.ace ?? 0)) * (angt1Act / (1.0 + angt1Act));

    R.angt2 = this.activation('angt2');
    R.brad = this.activation('brad');
  }

  private pressure(el: ElementState): number {
    const p = (el.volume - el.volume0) * el.elastance;
    return p < 0 ? 0 : p;
  }

  private trackRange(el: { pressure: number; pressureLo: number; pressureHi: number; tLo: number; tHi: number }, t: number): void {
    if (el.pressure <= el.pressureLo) { el.pressureLo = el.pressure; el.tLo = t; }
    if (el.pressure >= el.pressureHi) { el.pressureHi = el.pressure; el.tHi = t; }
  }

  private leading(el: { pressureLo: number; pressureHi: number; tLo: number; tHi: number }): number {
    return el.tLo <= el.tHi ? el.pressureLo : el.pressureHi;
  }

  private trailing(el: { pressureLo: number; pressureHi: number; tLo: number; tHi: number }): number {
    return el.tHi >= el.tLo ? el.pressureHi : el.pressureLo;
  }

  // ------------------------------------------------------------------
  // 推进一个显示点（原版 CalculateTrace：100 个积分步 + 2 个子样本）
  // ------------------------------------------------------------------
  step(): Frame {
    const s = this.state;
    const R = s.receptors;

    if (s.time >= s.receptorNext) {
      this.updateReceptors();
      s.receptorNext = s.time + RECEPTOR_DT;
    }

    const mus = R.mus ?? 0, vag = R.vag ?? 0, pde = R.pde ?? 0;
    const a1 = R.alpha1 ?? 0, b1 = R.beta1 ?? 0, b2 = R.beta2 ?? 0;
    const hmca = R.hmca ?? 0, dig = R.dig ?? 0;
    const smca = R.smca ?? 0, aden = R.aden ?? 0, kch = R.kch ?? 0;
    const nos = R.nos ?? 0, nox = R.nox ?? 0;
    const angt2 = R.angt2 ?? 0, brad = R.brad ?? 0;

    // 血管张力（原版 Art.Conductance / Elastance / Ven.Elastance）
    s.art.conductance = 5.0 * (1.0
      + 2.5 * mus * (1.0 - nos)
      + 1.9 * b2
      + 2.5 * aden
      + 2.0 * nox
      + 2.0 * pde
      + 0.95 * smca
      + 0.95 * kch
      + brad
      - 0.6 * nos
      - 1.35 * a1
      - 0.9 * angt2);
    s.art.conductance = Math.max(s.art.conductance, 0.25);
    s.art.elastance = (1 / 0.8) * (1.0 + 0.2 * a1);
    s.ven.elastance = (1 / 30) * (1.0 - 0.7 * Math.min(1.0, nox + smca - a1));

    // 显示点内极值追踪初始化
    const heart = s.heart, art = s.art, ven = s.ven;
    heart.pressureLo = POS_HUGE; heart.pressureHi = NEG_HUGE;
    art.pressureLo = POS_HUGE; art.pressureHi = NEG_HUGE;
    ven.pressureLo = POS_HUGE; ven.pressureHi = NEG_HUGE;
    s.conLo = POS_HUGE; s.conHi = NEG_HUGE;

    for (let i = 0; i < STEPS_PER_POINT; i++) {
      // 心跳调度（原版 t.Time >= Heart.NextBeat）
      if (s.time >= heart.nextBeat) {
        art.meanP = (art.maxP - art.minP) * 0.33 + art.minP;
        art.minP = 300.0;
        art.maxP = 0.0;
        heart.rate = 1.0 + 350.0 * (1.0 - 0.7 * vag - mus - aden + b1 - hmca + pde);
        heart.rate = Math.max(heart.rate, 1.0);
        heart.force = 8.0 * (1.0
          - 0.95 * mus
          - 0.95 * aden
          - 0.6 * kch
          + 1.5 * b1
          + dig
          + pde)
          * (1.0 - hmca)
          * (1.0 / (1.0 + heart.volume0 / heart.volume));
        heart.tsystole = 12.0 / 400.0;
        if (heart.tsystole >= 12.0 / heart.rate) heart.tsystole = 12.0 / heart.rate;
        heart.time = heart.tsystole;
        heart.nextBeat = s.time + 60.0 / heart.rate;
      }

      // 心收缩弹性：高斯脉冲（原版 exp(-x²)·Force）
      if (heart.time > 0.0) {
        const tMid = DT * Math.round((heart.tsystole * 0.5) / DT);
        const x = (heart.time - tMid) / (tMid * 0.33);
        heart.elastance = Math.exp(-x * x) * heart.force + ven.elastance * 4.0;
        heart.time -= DT;
      }

      if (dig > 0.95) {
        // 地高辛过量：诱发颤动，射血永久停止（原版 Fibrillation 不复位）
        heart.elastance = heart.force * this.addNoise(0.5) * 0.25;
        s.fibrillation += DT;
        heart.rate = 300.0 * this.addNoise(0.5);
        heart.pressure = 50.0 * this.addNoise(1.0);
      } else {
        heart.pressure = this.pressure(heart);
      }

      s.conPressure = heart.elastance;

      // 动脉阀（心 → 动脉）
      if (heart.pressure >= art.pressure && s.fibrillation <= 0.0) {
        heart.flow = (heart.pressure - art.pressure) * heart.conductance;
        art.volume += heart.flow * DT;
        heart.volume -= heart.flow * DT;
      }

      art.pressure = this.pressure(art);
      art.maxP = Math.max(art.maxP, art.pressure);
      art.minP = Math.min(art.minP, art.pressure);

      // 外周 runoff（动脉 → 静脉）
      art.flow = (art.pressure - ven.pressure) * art.conductance;
      ven.volume += art.flow * DT;
      art.volume -= art.flow * DT;

      ven.pressure = this.pressure(ven);

      // 静脉阀（静脉 → 心）
      if (ven.pressure >= heart.pressure && s.fibrillation <= 0.0) {
        ven.flow = (ven.pressure - heart.pressure) * ven.conductance;
        heart.volume += ven.flow * DT;
        ven.volume -= ven.flow * DT;
      }

      s.time += DT;

      this.trackRange(heart, s.time);
      this.trackRange(art, s.time);
      this.trackRange(ven, s.time);
      if (s.conPressure <= s.conLo) { s.conLo = s.conPressure; s.conTLo = s.time; }
      if (s.conPressure >= s.conHi) { s.conHi = s.conPressure; s.conTHi = s.time; }
    }

    // 死亡判定：动脉压 < 20 mmHg 持续 500 个显示点（原版 Dying 计数）
    if (!s.dead) {
      if (art.pressure < 20.0) s.dying += 1;
      else s.dying = 0;
      if (s.dying >= 500) {
        this.addEvent('death', 'Your rat has died!!!');
        s.dead = true;
      }
    }

    // 两个子样本（原版 GetLeadingPressure / GetTrailingPressure）
    // 死亡且开启"曲线拉平":心通道输出 0(教学可选,偏离原版室颤行为)
    const flat = s.dead && s.flattenAfterDeath;
    const hrNoise = s.noise && !flat ? this.addNoise(0.05) : 1;
    const t1 = s.points * SAMPLE_DT;
    this.trace.push({ t: t1, abp: this.leading(art), lvp: flat ? 0 : this.leading(heart), vbp: this.leading(ven), hf: flat ? 0 : this.leadingCon(), hr: flat ? 0 : heart.rate * hrNoise });
    s.points += 1;
    const t2 = s.points * SAMPLE_DT;
    const frame = { t: t2, abp: this.trailing(art), lvp: flat ? 0 : this.trailing(heart), vbp: this.trailing(ven), hf: flat ? 0 : this.trailingCon(), hr: flat ? 0 : heart.rate };
    this.trace.push(frame);
    s.points += 1;
    return frame;
  }

  private leadingCon(): number { return this.state.conTLo <= this.state.conTHi ? this.state.conLo : this.state.conHi; }
  private trailingCon(): number { return this.state.conTHi >= this.state.conTLo ? this.state.conHi : this.state.conLo; }

  advance(seconds: number): void {
    const count = Math.round(seconds / POINT_DT);
    for (let i = 0; i < count; i++) this.step();
  }

  // ------------------------------------------------------------------
  // 快照 / 恢复
  // ------------------------------------------------------------------
  exportSnapshot(): Snapshot {
    return JSON.parse(JSON.stringify({
      format: 'ratheart-simpro', version: 1 as const, modelVersion: MODEL_VERSION,
      savedAt: new Date().toISOString(), state: this.state, trace: this.trace, events: this.events
    }));
  }

  restore(snapshot: Snapshot): void {
    const data = JSON.parse(JSON.stringify(snapshot));
    if (data.format !== 'ratheart-simpro' || data.version !== 1) throw new Error('format mismatch');
    this.state = data.state;
    this.state.running = false;
    if (typeof this.state.receptorNext !== 'number') this.state.receptorNext = this.state.time;
    this.trace = data.trace;
    this.events = data.events;
  }

  // ------------------------------------------------------------------
  // 原版 .rat 文件导入（20400 字节文本头 + int16 交错 5 通道）
  // 通道顺序与原版写盘一致：[ABP, LVP, VBP, HF, HR]
  // ------------------------------------------------------------------
  importRAT(buffer: ArrayBuffer): boolean {
    const bytes = new Uint8Array(buffer);
    const header = new TextDecoder('windows-1252').decode(bytes.slice(0, 20400));
    const get = (key: string) => header.match(new RegExp(`(?:^|[\\r\\n])${key}=([^\\r\\n\\x00]*)`))?.[1]?.trim();
    const count = Number(get('NPOINTS'));
    const pithedText = get('PITHED');
    if (buffer.byteLength < 20400 || !Number.isInteger(count) || count < 0 || 20400 + count * 10 > buffer.byteLength) return false;
    this.reset(pithedText !== 'F');
    this.trace = [];
    const view = new DataView(buffer);
    for (let i = 0; i < count; i++) {
      const at = 20400 + i * 10;
      this.trace.push({
        t: i * SAMPLE_DT,
        abp: view.getInt16(at, true) * CH_SCALE.abp,
        lvp: view.getInt16(at + 2, true) * CH_SCALE.lvp,
        vbp: view.getInt16(at + 4, true) * CH_SCALE.vbp,
        hf: view.getInt16(at + 6, true) * CH_SCALE.hf,
        hr: view.getInt16(at + 8, true) * CH_SCALE.hr
      });
    }
    this.events = [];
    const markers = Number(get('NMARKERS') ?? 0);
    for (let i = 0; i < markers; i++) {
      const at = Number(get(`MKP${i}`) ?? get(`MKPOINT${i}`));
      const text = get(`MKT${i}`) ?? get(`MKTEXT${i}`) ?? '';
      if (Number.isInteger(at)) this.events.push({ t: at * SAMPLE_DT, kind: 'import', text });
    }
    this.state.time = count * SAMPLE_DT;
    this.state.points = count;
    const last = this.trace.at(-1);
    this.state.heart.rate = last?.hr ?? 400;
    this.state.art.pressure = last?.abp ?? 0;
    this.state.recorderStarted = false;
    this.state.historyOnly = true;
    return true;
  }

  // 原版 .rat 文件导出（与原版 SaveToFile 同构）
  exportRAT(): ArrayBuffer {
    const s = this.state;
    // 与原版 MarkerList 内容一致：给药、刺激与死亡标记
    const markers = this.events.filter(e => e.kind === 'dose' || e.kind === 'stimulus' || e.kind === 'death' || e.kind === 'import');
    const lines: string[] = [];
    lines.push(`NPOINTS=${this.trace.length}`);
    lines.push(`PITHED=${s.pithed ? 'T' : 'F'}`);
    lines.push(`NMARKERS=${markers.length}`);
    markers.forEach((e, i) => {
      lines.push(`MKP${i}=${Math.round(e.t / SAMPLE_DT)}`);
      lines.push(`MKT${i}=${e.text}`);
    });
    const header = new Uint8Array(20400);
    const text = lines.join('\r\n') + '\r\n';
    const encoded = new TextEncoder().encode(text);
    header.set(encoded.slice(0, 20400));
    const data = new Int16Array(this.trace.length * 5);
    this.trace.forEach((f, i) => {
      data[i * 5] = Math.round(f.abp / CH_SCALE.abp);
      data[i * 5 + 1] = Math.round(f.lvp / CH_SCALE.lvp);
      data[i * 5 + 2] = Math.round(f.vbp / CH_SCALE.vbp);
      data[i * 5 + 3] = Math.round(f.hf / CH_SCALE.hf);
      data[i * 5 + 4] = Math.round(f.hr / CH_SCALE.hr);
    });
    const out = new Uint8Array(20400 + data.byteLength);
    out.set(header, 0);
    out.set(new Uint8Array(data.buffer), 20400);
    return out.buffer;
  }

  /** 当前血药浓度（mg/kg）摘要（显示用） */
  activeDrugs(): { id: string; name: string; short: string; dose: number; injected: number }[] {
    return DRUGS
      .filter(d => !d.hidden && (this.state.doses[d.id].dose > 1e-9 || this.state.doses[d.id].injected > 1e-9))
      .map(d => ({ id: d.id, name: d.name, short: d.short, dose: this.state.doses[d.id].dose, injected: this.state.doses[d.id].injected }));
  }
}
