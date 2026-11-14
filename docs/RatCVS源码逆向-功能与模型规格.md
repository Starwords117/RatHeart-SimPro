# RatCVS 源码逆向：完整功能与心血管模型规格

> 重写依据。对象：RatCVS-3.3.5 目录内源码（RATMAIN.PAS 头注与窗体标题均为
> **V3.3.7 (30.07.20)**，J. Dempster, University of Strathclyde，Delphi XE VCL）。
> 网页重写版：`../RatCVS_Web/`。

## 1. 软件概述

模拟**去脑（pithed）大鼠 / 正常大鼠**在体心血管实验：股动脉插管测 ABP、左心室插管测
LVP、股静脉插管给药并测 VBP；HR 由脉搏计算，HF 为心收缩力。界面为图纸记录仪，
五通道波形 + 注药/刺激标注。附 11 种未知药（Drug A–K）盲检教学。

## 2. 全局常量与运行参数（RATMAIN.PAS）

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `MaxPoints` | 10 000 000 | ADC 缓冲上限（int16 × 5 通道 ≈ 100 MB） |
| `MaxDisplayPoints` | 4000 | 默认显示窗口（子样本数） |
| `FileHeaderSize` | (500+10)×40 = 20400 B | 文件头 |
| `t.Step` | 0.125 ms | 积分步长 |
| `NumStepsPerDisplayPoint` | 100 | 每显示点 12.5 ms 生理时间，输出 **2 个子样本**（leading/trailing） |
| `t.next` 步进 | 5 ms | 受体激活与血药动力学更新周期 |
| `TTimer.Interval` | 50 ms | UI/计算节拍 → 实际回放速度 0.25 生理秒/墙秒 |
| 通道标度 | ABP/LVP 300/2047、VBP 50/2047、HF 20/2047、HR 1600/2047 | 物理量 = ADC × 标度 |
| 通道写盘顺序 | `[ABP, LVP, VBP, HF, HR]` | `ADC[j+chABP]` 等，chABP=0 |
| 速率常数 | FastOn 0.006 / FastOff 0.0035 / SlowOn 0.002 / SlowOff 5e-4 | 每 5 ms 更新周期计 |

初始条件：Heart（Volume0=5, V=10, G=2500, E=1/30, Rate=400）；Art（V0=100, V=150,
G=0.05→每点重算, E=1/0.8）；Ven（V0=300, V=600, G=5000, E=1/30）。

## 3. 核心模型

### 3.1 三室集总参数模型

- `Pressure = max(0, (Volume − Volume0) × Elastance)`。
- 阀 1（心→动脉）：`HeartP ≥ ArtP` 时 `Flow = ΔP×2500`；阀 2（静脉→心）：`VenP ≥ HeartP` 时
  `Flow = ΔP×5000`；外周 runoff 恒通：`ArtFlow = (ArtP − VenP) × ArtConductance`。
- 心弹性：收缩期 `exp(−x²)·Force + VenE×4`，`x = (t−tMid)/(tMid×0.33)`，
  `tMid = TSystole/2`；`TSystole = min(12/400, 12/Rate)`。
- 每搏：`MeanABP = (Max−Min)×0.33 + Min`（用于压力感受器）；HR 与 Force 在每搏开始时重算。
- **血管张力**（每显示点）：
  `ArtG = 5×(1 + 2.5·Mus·(1−Nos) + 1.9·β2 + 2.5·Ade + 2·NOX + 2·PDE + 0.95·SMCa
  + 0.95·K + Brad − 0.6·Nos − 1.35·α1 − 0.9·Ang2)`，下限 0.25；
  `ArtE = (1/0.8)×(1+0.2·α1)`（升压时脉压增大）；
  `VenE = (1/30)×(1 − 0.7·min(1, NOX+SMCa−α1))`（静脉容量池效应）。
- **HR** = 1 + 350×(1 − 0.7·Vag − Mus − Ade + β1 − HMCa + PDE)，下限 1。
- **Force** = 8×(1 − 0.95·Mus − 0.95·Ade − 0.6·K + 1.5·β1 + Dig + PDE)×(1−HMCa)
  × 1/(1+V0/V)（Starling 项）。

### 3.2 统一竞争性受体模型（ReceptorActivation）

`x = Dose/(Potency×PotencyShift)`；`激活 = Σ(效能ᵢ·xᵢ)/(1+Σxᵢ)`，分母初值 1。
激动药效能 1，拮抗药 0（只占分母）。β1/β2 的 `PotencyShift = 1 − PDE×0.5`。
所有药物共用受体池，按 `Drugs[0..]` 注册顺序累加。

### 3.3 血药动力学（每 5 ms）

`Dose += k_on×(Injected − Dose) − k_off×Dose`；`Injected −= Injected×k_off`。
注射时 `Injected = 剂量 × AddNoise(0.1)`；效力参数创建时 `×AddNoise(0.5)`；
HR 通道 leading 子样本 `×AddNoise(0.05)`。Delphi `Random` 未 Randomize——
每次启动序列固定。

### 3.4 闭环调节（仅正常大鼠）

- 基础交感张力：`Alpha1N.Dose = Potency×0.4`；`Beta1N.Dose = Potency×0.2`（每 5 ms 赋值）。
- 压力感受器：`Vagus.Dose = max(Dose, VagPotency × 5/(1+e^(−(MAP−130)/8)))`。
- 静息肾神经→AngⅠ 张力（两种模型均有）：`Renal.Dose = max(Dose, Angt1Potency×0.25)`。
- ACE 实时生成 AngⅡ：`Ang2ACE.Dose = Angt2Potency×5×(1−ACE)×(Angt1/(1+Angt1))`。

### 3.5 特殊状态

- **死亡**：`ArtP < 20 mmHg` 连续 500 个显示点 → 标注 "Your rat has died!!!"，模型继续运行。
- **地高辛过量**：`DigR > 0.95`（剂量 ≳ 19×效力，即 ≳10 mg/kg）→ 心弹性与 HR 噪声化、
  `Fibrillation` 累积（**永不复位**）→ 两阀永久关闭 → 血压崩溃 → 死亡判定触发。

## 4. 药物总表（42 条，注册顺序即 sourceIndex）

激动药 0–8：Adrenaline(α1 5e-3/β1 3.5e-3/β2 5e-3)、Noradrenaline(1e-2/1.5e-2/1.5e-1)、
Isoprenaline(β1 1e-3/β2 7e-4)、Phenylephrine(α1 1e-2)、Acetylcholine(M 5e-3/N 0.15/α1 0.3/β1 0.15,
k_off×2)、Adenosine(1.0)、Cromakalim(K 0.3,慢)、AngiotensinⅠ(1e-4)、AngiotensinⅡ(1e-4)。

拮抗/抑制药 9–22：Propranolol(β 0.5)、Atenolol(β1 10)、Phentolamine(α 0.1)、Prazosin(α1 0.1)、
Atropine(M/Vag 0.1)、8-s-p-theophylline(Aden 5)、Verapamil(HMCa/SMCa 0.75,慢)、L-NOARG(NOS 10)、
Captopril(ACE 5,慢)、Losartan(Ang2 1)、Digoxin(Dig 0.5,k_on×0.25)、Glyceryl trinitrate(NOX 10,快)、
Milrinone(PDE 10,慢)、Glibenclamide(K 1)。剂量范围见 `catalog.ts`。

未知药 23–33（答案）：A=Ach(N 0.1)、B=Adenosine、C=Isoprenaline(k_off 慢)、D=Nor、
E=硝普钠(NOX 15)、F=Cromakalim、G=Milrinone、H=Propranolol(β 10)、I=Verapamil、
J=L-NOARG、K=Atropine。对应原版 `Unknown Drugs (Rat CVS V3.2).txt`。

内部条目 34–41：心交感（**未使用**，见 §6）、肾上腺交感、血管交感、迷走、肾神经(Angt1 2e-4)、
基础交感 α1/β1、ACE 生成 AngⅡ。

### 4.1 神经刺激剂量（bStimulationOnClick，无噪声）

| 通路 | 注入 | 剂量 |
| --- | --- | --- |
| 交感(不含肾上腺) | SympNerve | 4×β1Potency×(0.5+α2激活) |
| 交感(心脏) | **Drugs[0]=肾上腺素** | 5×Adrβ1Potency×(0.5+α2激活) |
| 交感(肾上腺) | AdrenNerve | 2×β1Potency |
| 肾神经 | Renal | 5×Angt1Potency |
| 迷走 | Vagus | 10×VagPotency |

### 4.2 剂量序列与标注

`SetDoseList`：1/2/5×10ⁿ 自 MinDose 至 MaxDose；MaxDose≤1 → μg/kg（内部 ×1e-3），
否则 mg/kg。标注 `format('%s %.3g %s', Short, Dose×Scale, Units)`，
单位判定在**注射时**用 `Dose<1.0`（与下拉规则不一致，原版行为）。

## 5. 用户交互规格

开始/停止记录；开始后锁定动物模型切换（直至新建实验）；药物三页签下拉 +
剂量下拉 + 注射；神经刺激五单选 + 刺激按钮；显示窗口（edTDisplay ± ×2/÷2 按钮、
滚动条、Start Time）；绿色垂直测量光标（?y 读数）；File: New/Load/Save/Print；
Edit: Copy Data/Copy Image。保存格式 `.rat`：20400 B 文本头
（`NPOINTS=`、`PITHED=`、`NMARKERS=`、`MKPn=`、`MKTn=`，CRLF，零填充）+
int16-LE 5 通道交错。OpenDialog 设计期 DefaultExt=rcv 为残留，运行时为 `.rat`。

## 6. 原版行为细节备忘（“手感”与缺陷）

1. **iSympHeart 缺陷**：声明后从未赋值 → “刺激心交感神经”注入肾上腺素（Drugs[0]），
   产生 α1+β1+β2 混合效应而非单纯心脏效应。复刻版保留，已标注。
2. Vagus 递质 `RemovalRate = FastOn×4`（疑为 FastOff 笔误）→ 刺激效应极短。
3. `NicChR` 计算后未使用（`-0.9*NicChR` 已注释）。
4. 酚妥拉明与去氧肾上腺素短名同为 `Phe`（重写版改为 `Phen`）。
5. BradR 通路保留但无药物连接（Captopril 的 BradR 激动已在 V3.3.0 移除）。
6. 显示范围溢出时 yMax×1.1 自动扩展；水平零光标每帧强制归零。
7. 版本参数演化：3.3.4（Adr α1↑β2↓）→ 3.3.5 恢复为 α1 5e-3/β2 5e-3 以复现
   “5–10 μg/kg 升压”；3.3.7 通道阻断剂/酶抑制剂移入拮抗药列表。

## 7. 重写注意（与原版的差异决策）

- 随机源：mulberry32 + 种子（原版 Delphi LCG 固定序列）；噪声可关。
- 时间轴：生理时间（诚实标定）；回放默认 0.25× 保留原版节奏，可调。
- 波形浮点存储；`.rat` 导出时量化 int16。
- 肾上腺素标注短名保留 `Adr`；酚妥拉明改 `Phen`。
- UI 全中文；新增循环药物浓度查看、自动保存、授课广播、跟随页。
