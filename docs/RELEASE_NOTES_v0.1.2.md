## RatHeart-SimPro v0.1.2

大鼠心血管系统药理实验模拟（RatCVS 3.3.7 模型的 TypeScript 重构；原模型 © John Dempster, University of Strathclyde）。

### 下载

| 平台 | 文件 | 说明 |
|---|---|---|
| Windows | `RatHeart-SimPro-0.1.2-x64-Setup.exe` | 安装版（中文向导） |
| Windows | `RatHeart-SimPro-0.1.2-x64-Portable.exe` | 免安装版 |
| Linux | `RatHeart-SimPro-0.1.2-x86_64-AppImage` | 通用免安装 |
| Linux | `ratheart-simpro_0.1.2_amd64.deb` | Debian / Ubuntu |
| macOS（Intel） | `RatHeart-SimPro-0.1.2-mac.zip` | 解压即用 |
| macOS（Apple Silicon） | `RatHeart-SimPro-0.1.2-arm64-mac.zip` | 解压即用 |

安装包未签名：Windows 首次运行 SmartScreen 提示「仍要运行」；macOS 首次打开需右键 → 打开。完整性校验见 `SHA256SUMS.txt`。

### 本版新内容（相对 v0.1.1）

- **1920×1080 大屏布局**：曲线显示区扩大至 1460×640（面积约 +135%），页面吃满全宽；
  移除页面标题块；「导入实验 / 导出」移入走纸控制行、紧邻「开始授课广播」左侧。
  仅 ≥1920 视口生效，笔记本/手机布局不变。
- **修复：「正常大鼠」无法选中**（模型切换消息映射反转所致），并保留记录开始后的模型锁定提示。
- **修复：图表文字重叠**：图表只标注实验操作（给药/刺激/死亡/导入），
  新建实验/切换模型等状态事件仅保留在「实验记录」面板。

### 主要内容

- RatCVS 3.3.7 三室心血管模型完整移植（去脑 / 正常大鼠双模型；49 项内核核验 + 8 项 Worker 核验，基线与原版 `.rat` 记录逐项吻合）
- 42 条药物（含 11 种未知药盲检）、5 条自主神经刺激通路
- 五通道图纸记录仪（ABP / LVP / VBP / HF / HR）、药物标注、测量光标、回看
- 原版 `.rat` 记录文件导入 / 导出互通
- 授课广播（教师端一键广播、学生浏览器跟随页）、PWA 离线可用

### 已知限制

- 默认 0.25× 回放速度为原版走纸节奏（时间轴为生理时间），可切换 1× / 2× / 5×
- 无代码签名（教学内网分发无碍）
- 自动保存保存在浏览器 localStorage，最近约 10 分钟波形
