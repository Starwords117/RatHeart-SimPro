// ============================================================
// RatCVS 药物目录 —— 对应 RATMAIN.PAS InitializeSimulation 的
// 药物注册顺序（V3.3.7 (30.07.20)，RatCVS-3.3.5 目录内源码）。
// 剂量单位：mg/kg（原版内部单位）。
// targets 为效力参数 Potency（mg/kg）；antagonist=true 表示以
// SetAntagonistPotency 注册（Efficacy=0，只占据受体不激活）。
// ============================================================

export type TargetId =
  | 'alpha1' | 'alpha2' | 'beta1' | 'beta2'
  | 'mus' | 'vag' | 'nic'
  | 'hmca' | 'smca'
  | 'aden' | 'kch' | 'nox' | 'nos'
  | 'angt1' | 'angt2' | 'brad' | 'ace' | 'dig' | 'pde';

export const TARGET_LABELS: Record<TargetId, string> = {
  alpha1: 'α₁ 肾上腺素受体', alpha2: 'α₂ 肾上腺素受体',
  beta1: 'β₁ 肾上腺素受体', beta2: 'β₂ 肾上腺素受体',
  mus: 'M 胆碱受体', vag: '迷走效应 M 受体', nic: 'N 胆碱受体（神经节）',
  hmca: '心肌钙通道', smca: '血管平滑肌钙通道',
  aden: '腺苷受体', kch: 'K⁺ 通道（K-ATP）', nox: '一氧化氮供体通路',
  nos: '一氧化氮合酶（NOS）', angt1: '血管紧张素Ⅰ受体', angt2: '血管紧张素Ⅱ受体',
  brad: '缓激肽受体', ace: '血管紧张素转换酶（ACE）', dig: 'Na⁺/K⁺-ATP 酶（洋地黄）',
  pde: '磷酸二酯酶（PDE）'
};

export interface DrugDefinition {
  id: string;
  /** RATMAIN.PAS 中 Drugs[] 的注册序号 */
  sourceIndex: number;
  name: string;
  english: string;
  /** 图表标注缩写（与原版 .rat 记录标注一致，ASCII）。 */
  short: string;
  group: 'agonist' | 'antagonist' | 'unknown';
  /** 神经通路/内部递质条目：不进入给药下拉列表 */
  hidden?: boolean;
  minDose: number;
  maxDose: number;
  onRate: number;
  removalRate: number;
  targets: Partial<Record<TargetId, number>>;
  antagonist?: boolean;
  mechanism: string;
}

// 原版速率常数（RATMAIN.PAS:434-437）
export const FAST_ON = 0.006;
export const FAST_OFF = 0.0035;
export const SLOW_ON = 0.002;
export const SLOW_OFF = 5e-4;

export const DRUGS: DrugDefinition[] = [
  // ---- 激动药（Agonists，sourceIndex 0-8）----
  {
    id: 'adrenaline', sourceIndex: 0, name: '肾上腺素', english: 'Adrenaline', short: 'Adr',
    group: 'agonist', minDose: 1e-4, maxDose: 1e-1, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { alpha1: 5e-3, beta1: 3.5e-3, beta2: 5e-3 },
    mechanism: '激动 α₁/β₁/β₂ 受体：低剂量以 β₂ 扩血管为主（血压可略降），高剂量 α₁ 缩血管占优（血压升高），心率始终加快。'
  },
  {
    id: 'noradrenaline', sourceIndex: 1, name: '去甲肾上腺素', english: 'Noradrenaline', short: 'Nor',
    group: 'agonist', minDose: 1e-3, maxDose: 1, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { alpha1: 1e-2, beta1: 1.5e-2, beta2: 1.5e-1 },
    mechanism: '主要激动 α₁ 受体（强烈升压），β₁ 作用较弱，β₂ 几乎无作用；升压反射在去脑大鼠中不明显。'
  },
  {
    id: 'isoprenaline', sourceIndex: 2, name: '异丙肾上腺素', english: 'Isoprenaline', short: 'Iso',
    group: 'agonist', minDose: 1e-4, maxDose: 1e-1, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { beta1: 1e-3, beta2: 7e-4 },
    mechanism: 'β₁/β₂ 受体激动药：心率加快、心肌收缩力增强，β₂ 扩血管使血压下降。'
  },
  {
    id: 'phenylephrine', sourceIndex: 3, name: '去氧肾上腺素', english: 'Phenylephrine', short: 'Phe',
    group: 'agonist', minDose: 1e-3, maxDose: 1, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { alpha1: 1e-2 },
    mechanism: '选择性 α₁ 受体激动药：血管收缩、血压升高，对心率无直接作用。'
  },
  {
    id: 'acetylcholine', sourceIndex: 4, name: '乙酰胆碱', english: 'Acetylcholine', short: 'Ach',
    group: 'agonist', minDose: 1e-3, maxDose: 1, onRate: FAST_ON, removalRate: FAST_OFF * 2,
    targets: { mus: 5e-3, nic: 0.15, alpha1: 0.3, beta1: 0.15 },
    mechanism: '激动 M 受体（降压、减慢心率、抑制心肌）；大剂量时其 α₁/β₁ 样作用显现——阿托品化后给药反而升高血压、加快心率。'
  },
  {
    id: 'adenosine', sourceIndex: 5, name: '腺苷', english: 'Adenosine', short: 'Ade',
    group: 'agonist', minDose: 0.1, maxDose: 100, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { aden: 1.0 },
    mechanism: '激动腺苷受体：减慢心率、减弱心肌收缩力并扩张血管。'
  },
  {
    id: 'cromakalim', sourceIndex: 6, name: '克罗卡林', english: 'Cromakalim', short: 'Cro',
    group: 'agonist', minDose: 0.1, maxDose: 100, onRate: SLOW_ON, removalRate: SLOW_OFF,
    targets: { kch: 0.3 },
    mechanism: 'K-ATP 通道开放药：促进 K⁺ 外流使血管平滑肌超极化，血管扩张、血压下降；起效与消退较慢。'
  },
  {
    id: 'angiotensin1', sourceIndex: 7, name: '血管紧张素Ⅰ', english: 'Angiotensin I', short: 'An1',
    group: 'agonist', minDose: 1e-4, maxDose: 1e-2, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { angt1: 1e-4 },
    mechanism: '本身活性低，经 ACE 转换为血管紧张素Ⅱ后发挥作用——其升压作用可被卡托普利阻断。'
  },
  {
    id: 'angiotensin2', sourceIndex: 8, name: '血管紧张素Ⅱ', english: 'Angiotensin II', short: 'An2',
    group: 'agonist', minDose: 1e-4, maxDose: 1e-2, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { angt2: 1e-4 },
    mechanism: '直接激动血管紧张素Ⅱ受体：强烈缩血管、升压；作用不被 ACE 抑制药影响，但可被氯沙坦阻断。'
  },

  // ---- 拮抗 / 抑制药（Antagonists，sourceIndex 9-22）----
  {
    id: 'propranolol', sourceIndex: 9, name: '普萘洛尔', english: 'Propranolol', short: 'Pro',
    group: 'antagonist', minDose: 0.01, maxDose: 100, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { beta1: 0.5, beta2: 0.5 }, antagonist: true,
    mechanism: '非选择性 β 受体阻断药：拮抗异丙肾上腺素/肾上腺素的加快心率与扩血管作用。'
  },
  {
    id: 'atenolol', sourceIndex: 10, name: '阿替洛尔', english: 'Atenolol', short: 'Ate',
    group: 'antagonist', minDose: 1, maxDose: 1000, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { beta1: 10 }, antagonist: true,
    mechanism: '选择性 β₁ 受体阻断药：拮抗心脏兴奋作用，对 β₂ 介导的血管舒张影响小。'
  },
  {
    id: 'phentolamine', sourceIndex: 11, name: '酚妥拉明', english: 'Phentolamine', short: 'Phen',
    group: 'antagonist', minDose: 0.01, maxDose: 10, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { alpha1: 0.1, alpha2: 0.1 }, antagonist: true,
    mechanism: 'α 受体阻断药：拮抗去甲肾上腺素/去氧肾上腺素的升压作用，并减弱交感神经刺激的升压反应。'
  },
  {
    id: 'prazosin', sourceIndex: 12, name: '哌唑嗪', english: 'Prazosin', short: 'Pra',
    group: 'antagonist', minDose: 0.01, maxDose: 10, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { alpha1: 0.1 }, antagonist: true,
    mechanism: '选择性 α₁ 受体阻断药：拮抗 α₁ 介导的升压反应，对 α₂ 无作用（与酚妥拉明相区别）。'
  },
  {
    id: 'atropine', sourceIndex: 13, name: '阿托品', english: 'Atropine', short: 'Atr',
    group: 'antagonist', minDose: 0.01, maxDose: 10, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { mus: 0.1, vag: 0.1 }, antagonist: true,
    mechanism: 'M 受体阻断药：取消乙酰胆碱的降压与减慢心率作用，阻断迷走神经刺激效应。'
  },
  {
    id: '8spt', sourceIndex: 14, name: '8-对磺苯基茶碱', english: '8-s-p-theophylline', short: '8spt',
    group: 'antagonist', minDose: 0.1, maxDose: 100, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { aden: 5.0 }, antagonist: true,
    mechanism: '腺苷受体阻断药：拮抗腺苷的负性频率与扩血管作用。'
  },
  {
    id: 'verapamil', sourceIndex: 15, name: '维拉帕米', english: 'Verapamil', short: 'Ver',
    group: 'antagonist', minDose: 0.1, maxDose: 100, onRate: SLOW_ON, removalRate: SLOW_OFF,
    targets: { hmca: 0.75, smca: 0.75 },
    mechanism: '钙通道阻滞药：减慢心率、抑制心肌收缩力并扩张血管；起效与消退较慢。'
  },
  {
    id: 'lnoarg', sourceIndex: 16, name: 'L-硝基精氨酸', english: 'L-NOARG', short: 'LNO',
    group: 'antagonist', minDose: 1, maxDose: 1000, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { nos: 10.0 },
    mechanism: '一氧化氮合酶抑制药：取消 NO 介导的舒张，血压轻度升高，并减弱乙酰胆碱等经 NO 的扩血管成分。'
  },
  {
    id: 'captopril', sourceIndex: 17, name: '卡托普利', english: 'Captopril', short: 'Cap',
    group: 'antagonist', minDose: 1, maxDose: 1000, onRate: SLOW_ON, removalRate: SLOW_OFF,
    targets: { ace: 5.0 },
    mechanism: 'ACE 抑制药：阻断血管紧张素Ⅰ→Ⅱ的转换，取消循环 AngⅡ 的基础缩血管张力与肾神经的升压效应；不影响外源性 AngⅡ。'
  },
  {
    id: 'losartan', sourceIndex: 18, name: '氯沙坦', english: 'Losartan', short: 'Los',
    group: 'antagonist', minDose: 1, maxDose: 1000, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { angt2: 1.0 }, antagonist: true,
    mechanism: '血管紧张素Ⅱ受体（AT₁）阻断药：拮抗外源性 AngⅡ 与 ACE 生成的 AngⅡ 的升压作用。'
  },
  {
    id: 'digoxin', sourceIndex: 19, name: '地高辛', english: 'Digoxin', short: 'Dig',
    group: 'antagonist', minDose: 0.1, maxDose: 100, onRate: SLOW_ON * 0.25, removalRate: SLOW_OFF,
    targets: { dig: 0.5 },
    mechanism: '抑制心肌 Na⁺/K⁺-ATP 酶：治疗量增强心肌收缩力；过量（DigR>0.95）诱发心室颤动——心脏射血停止，血压崩溃。'
  },
  {
    id: 'glyceryltrinitrate', sourceIndex: 20, name: '硝酸甘油', english: 'Glyceryl trinitrate', short: 'GTN',
    group: 'antagonist', minDose: 1, maxDose: 1000, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { nox: 10.0 },
    mechanism: 'NO 供体：不依赖血管内皮直接释放 NO 扩张血管，降压；L-NOARG 不影响其作用。'
  },
  {
    id: 'milrinone', sourceIndex: 21, name: '米力农', english: 'Milrinone', short: 'Mil',
    group: 'antagonist', minDose: 1, maxDose: 1000, onRate: SLOW_ON, removalRate: SLOW_OFF,
    targets: { pde: 10.0 },
    mechanism: '磷酸二酯酶抑制药：正性肌力、加快心率并扩张血管；还增强 β 受体介导的反应（cAMP 通路协同）。'
  },
  {
    id: 'glibenclamide', sourceIndex: 22, name: '格列本脲', english: 'Glibenclamide', short: 'Gli',
    group: 'antagonist', minDose: 0.1, maxDose: 100, onRate: SLOW_ON, removalRate: SLOW_OFF,
    targets: { kch: 1.0 }, antagonist: true,
    mechanism: 'K-ATP 通道阻断药：拮抗克罗卡林的扩血管作用。'
  },

  // ---- 未知药（Unknowns，sourceIndex 23-33，学生盲检）----
  {
    id: 'drug_a', sourceIndex: 23, name: '未知药 A', english: 'Drug A', short: 'A',
    group: 'unknown', minDose: 1e-3, maxDose: 1, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { mus: 5e-3, nic: 0.1, alpha1: 0.3, beta1: 0.15 },
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },
  {
    id: 'drug_b', sourceIndex: 24, name: '未知药 B', english: 'Drug B', short: 'B',
    group: 'unknown', minDose: 0.1, maxDose: 1000, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { aden: 1.0 },
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },
  {
    id: 'drug_c', sourceIndex: 25, name: '未知药 C', english: 'Drug C', short: 'C',
    group: 'unknown', minDose: 1e-4, maxDose: 1e-1, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { beta1: 1e-3, beta2: 7e-4 },
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },
  {
    id: 'drug_d', sourceIndex: 26, name: '未知药 D', english: 'Drug D', short: 'D',
    group: 'unknown', minDose: 1e-3, maxDose: 1, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { alpha1: 1e-2, beta1: 1.5e-2, beta2: 1.5e-1 },
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },
  {
    id: 'drug_e', sourceIndex: 27, name: '未知药 E', english: 'Drug E', short: 'E',
    group: 'unknown', minDose: 1, maxDose: 1000, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { nox: 15.0 },
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },
  {
    id: 'drug_f', sourceIndex: 28, name: '未知药 F', english: 'Drug F', short: 'F',
    group: 'unknown', minDose: 1, maxDose: 1000, onRate: SLOW_ON, removalRate: SLOW_OFF,
    targets: { kch: 0.3 },
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },
  {
    id: 'drug_g', sourceIndex: 29, name: '未知药 G', english: 'Drug G', short: 'G',
    group: 'unknown', minDose: 1, maxDose: 1000, onRate: SLOW_ON, removalRate: SLOW_OFF,
    targets: { pde: 10.0 },
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },
  {
    id: 'drug_h', sourceIndex: 30, name: '未知药 H', english: 'Drug H', short: 'H',
    group: 'unknown', minDose: 1, maxDose: 1000, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { beta1: 10.0, beta2: 10.0 }, antagonist: true,
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },
  {
    id: 'drug_i', sourceIndex: 31, name: '未知药 I', english: 'Drug I', short: 'I',
    group: 'unknown', minDose: 0.1, maxDose: 100, onRate: SLOW_ON, removalRate: SLOW_OFF,
    targets: { hmca: 0.75, smca: 0.75 },
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },
  {
    id: 'drug_j', sourceIndex: 32, name: '未知药 J', english: 'Drug J', short: 'J',
    group: 'unknown', minDose: 1, maxDose: 1000, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { nos: 10.0 },
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },
  {
    id: 'drug_k', sourceIndex: 33, name: '未知药 K', english: 'Drug K', short: 'K',
    group: 'unknown', minDose: 0.1, maxDose: 100, onRate: FAST_ON, removalRate: SLOW_OFF,
    targets: { mus: 0.1, vag: 0.1 }, antagonist: true,
    mechanism: '未知样品：根据血压、心率反应与药物鉴别实验推断其作用受体。'
  },

  // ---- 神经通路递质 / 内部条目（sourceIndex 34-41，不出现在给药列表）----
  {
    id: 'cardiac_symp', sourceIndex: 34, name: '心交感神经（内部）', english: 'Cardiac', short: 'Symp(H)',
    group: 'agonist', hidden: true, minDose: 0, maxDose: 0, onRate: FAST_ON * 4, removalRate: FAST_OFF * 4,
    targets: { beta1: 1.5e-2 },
    mechanism: '心交感神经末梢递质条目。注意：原版 RATMAIN.PAS 未给 iSympHeart 赋值（恒为 0），“刺激心交感神经”实际注入 Drugs[0]（肾上腺素），本版按原版行为复刻。'
  },
  {
    id: 'adrenal_symp', sourceIndex: 35, name: '肾上腺交感神经（内部）', english: 'AdrenNerve', short: 'Symp(AD)',
    group: 'agonist', hidden: true, minDose: 0, maxDose: 0, onRate: FAST_ON * 2, removalRate: FAST_OFF,
    targets: { alpha1: 5e-3, beta1: 3.55e-3, beta2: 5e-3 },
    mechanism: '刺激内脏大神经→肾上腺髓质释放肾上腺素入血。'
  },
  {
    id: 'symp_vessel', sourceIndex: 36, name: '血管交感神经（内部）', english: 'SympNerve', short: 'Symp(-AD)',
    group: 'agonist', hidden: true, minDose: 0, maxDose: 0, onRate: FAST_ON * 7, removalRate: FAST_OFF * 4,
    targets: { alpha1: 1e-2, beta1: 1.5e-2, beta2: 1.5e-1 },
    mechanism: '刺激除肾上腺外的交感神经：末梢释放去甲肾上腺素，以 α₁ 缩血管为主。'
  },
  {
    id: 'vagus_nerve', sourceIndex: 37, name: '迷走神经（内部）', english: 'Vagus', short: 'Vag. Nv.',
    group: 'agonist', hidden: true, minDose: 0, maxDose: 0, onRate: FAST_ON * 4, removalRate: FAST_ON * 4,
    targets: { vag: 5e-3 },
    mechanism: '刺激迷走神经外周端：释放乙酰胆碱激动心肌 M 受体，减慢心率（可被阿托品阻断）。'
  },
  {
    id: 'renal_nerve', sourceIndex: 38, name: '肾神经（内部）', english: 'Renal', short: 'Ren. Nv.',
    group: 'agonist', hidden: true, minDose: 0, maxDose: 0, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { angt1: 2e-4 },
    mechanism: '刺激肾神经：促进肾素释放→生成血管紧张素Ⅰ（静息张力为其 25%），经 ACE 转换为 AngⅡ 后缓慢升压。'
  },
  {
    id: 'alpha1_nerve', sourceIndex: 39, name: '基础交感张力-血管（内部）', english: 'Alpha1', short: '???',
    group: 'agonist', hidden: true, minDose: 0, maxDose: 0, onRate: FAST_ON, removalRate: FAST_OFF * 2,
    targets: { alpha1: 1e-2 },
    mechanism: '正常大鼠基础交感缩血管张力（仅正常大鼠模型启用）。'
  },
  {
    id: 'beta1_nerve', sourceIndex: 40, name: '基础交感张力-心脏（内部）', english: 'Beta1', short: '???',
    group: 'agonist', hidden: true, minDose: 0, maxDose: 0, onRate: FAST_ON, removalRate: FAST_OFF * 2,
    targets: { beta1: 1e-2 },
    mechanism: '正常大鼠基础心交感张力（仅正常大鼠模型启用）。'
  },
  {
    id: 'ang2_ace', sourceIndex: 41, name: 'ACE 生成的血管紧张素Ⅱ（内部）', english: 'AngiotensinIIACE', short: 'An2',
    group: 'agonist', hidden: true, minDose: 0, maxDose: 0, onRate: FAST_ON, removalRate: FAST_OFF,
    targets: { angt2: 1e-4 },
    mechanism: '由 AngⅠ 经 ACE 在体内实时生成的血管紧张素Ⅱ（受卡托普利/氯沙坦调控）。'
  }
];

export function drugById(id: string): DrugDefinition {
  const drug = DRUGS.find(d => d.id === id);
  if (!drug) throw new Error(`unknown drug id: ${id}`);
  return drug;
}

// ---- 神经刺激通路（对应原版 StimulationTypeGrp 的 5 个单选钮）----
export interface NervePathway {
  id: string;
  name: string;
  english: string;
  hint: string;
}

export const NERVE_PATHWAYS: NervePathway[] = [
  { id: 'symp_vessel', name: '交感神经（不含肾上腺）', english: 'Symp. nerves (exc. adrenal)', hint: '刺激血管交感神经末梢，释放去甲肾上腺素' },
  { id: 'cardiac_symp', name: '交感神经（心脏支）', english: 'Symp. nerves to heart', hint: '按原版行为注入肾上腺素样刺激（见原版 iSympHeart 缺陷）' },
  { id: 'adrenal_symp', name: '交感神经（肾上腺支）', english: 'Symp. nerves to adrenals', hint: '刺激肾上腺髓质释放肾上腺素' },
  { id: 'renal_nerve', name: '肾神经', english: 'Renal nerve', hint: '促进肾素释放，经 ACE→AngⅡ 缓慢升压' },
  { id: 'vagus_nerve', name: '迷走神经', english: 'Vagus nerve', hint: '释放乙酰胆碱减慢心率，可被阿托品阻断' }
];

// ---- 剂量序列（对应原版 SetDoseList：1/2/5×10ⁿ，MinDose→MaxDose）----
export interface DoseOption { label: string; value: number; }

export function doseList(drug: DrugDefinition): DoseOption[] {
  const micro = drug.maxDose <= 1.0;
  const unit = micro ? 'ug/kg' : 'mg/kg';
  const scale = micro ? 1000 : 1;
  const options: DoseOption[] = [];
  let dose = drug.minDose;
  while (dose <= drug.maxDose) {
    if (dose <= drug.maxDose) options.push({ label: `${(dose * scale).toFixed(2)} ${unit}`, value: dose });
    if (2 * dose <= drug.maxDose) options.push({ label: `${(2 * dose * scale).toFixed(1)} ${unit}`, value: 2 * dose });
    if (5 * dose <= drug.maxDose) options.push({ label: `${(5 * dose * scale).toFixed(1)} ${unit}`, value: 5 * dose });
    dose *= 10;
  }
  return options;
}

/** 图表标注文本（与原版 format('%s %.3g %s',[ShortName,Dose*Scale,Units]) 一致）。
 *  注意原版单位判定在标注时用 Dose<1.0（而非 MaxDose），因此 0.5 mg/kg
 *  的腺苷会标注为 “Ade 500 ug/kg”——复刻此行为。 */
export function doseAnnotation(drug: DrugDefinition, dose: number): string {
  const micro = dose < 1.0;
  const unit = micro ? 'ug/kg' : 'mg/kg';
  const scale = micro ? 1000 : 1;
  return `${drug.short} ${Number((dose * scale).toPrecision(3))} ${unit}`;
}
