## RatHeart-SimPro v0.2.0

大鼠心血管系统药理实验模拟（RatCVS 3.3.7 模型的 TypeScript 重构；原模型 © John Dempster, University of Strathclyde）。

**本版起桌面版改用 Tauri 构建**（系统 WebView，安装体积缩小约 25 倍），取代 Electron。
此前的 Electron 版 v0.2.0 / v0.2.1 Release 已删除；功能与它们完全一致并包含全部修复。

### 下载

| 平台 | 文件 | 说明 |
|---|---|---|
| Windows | `RatHeart-SimPro_0.2.0_x64-setup.exe` | NSIS 中文安装向导（WebView2 缺失时自动安装） |
| Linux | `ratheart-simpro_0.2.0_amd64.deb` | Debian / Ubuntu 22.04+（系统 webkit2gtk，约 4 MB） |
| Linux | `ratheart-simpro-0.2.0.x86_64.rpm` | Fedora / RHEL 系 |
| Linux | `RatHeart-SimPro_0.2.0_amd64.AppImage` | 通用免安装（全捆绑 GUI 库，约 110 MB） |
| macOS | `RatHeart-SimPro_0.2.0_universal.dmg` | Intel + Apple Silicon 一体（macOS 12+） |

安装包未签名：Windows 首次运行 SmartScreen 提示「仍要运行」（并允许防火墙访问，授课广播需要）；macOS 首次打开需右键 → 打开。完整性校验见 `SHA256SUMS.txt`。

### 桌面版变化（Electron → Tauri）

- **安装体积**：Windows/Linux 安装包从约 100 MB 缩至约 4 MB（Linux deb/rpm 使用系统 webkit2gtk-4.1）；启动更快、内存占用更低
- **文件导出**改为原生保存对话框（可选目录/文件名，不再固定写入下载目录）
- Linux 底线为 Debian 12 / Ubuntu 22.04 / Fedora 37+（自带 webkit2gtk-4.1）；Windows 10+；macOS 12+
- 广播服务器以 Rust 重写（`crates/ratheart-server`，与网页 CLI 版共享 9 项端到端核验），桌面版内嵌服务器行为不变

### 主要内容（与 v0.2.1 等同）

- **授课广播体系**：多教师房间隔离（跟随链接 `?room=`）、教师令牌防伪造、
  SSE 长连接（轮询回退）、回放缓冲匀速重放（曲线与时间平滑）、停止竞态修复、
  服务器会话自动清理、学生误开主页引导横幅、局域网地址自动提示（ⓘ 展开备用）
- **教学工具**：对比叠加（半透明 ghost 曲线）、量效曲线工具
  （自动剂量-反应表格 + 对数散点图 + CSV）、测量工作表（光标取数导出）、
  死亡后曲线拉平开关（默认保持原版室颤行为）
- **工程质量**：TypeScript 类型检查、广播链路端到端测试 9 项、
  Playwright headless UI 测试（含全按钮巡游 17 步）、GitHub Actions 自动检查/发版
- RatCVS 3.3.7 三室心血管模型完整移植（52 项内核核验 + 8 项 Worker 核验
  + 9 项广播端到端核验，基线与原版 `.rat` 记录逐项吻合）
- 42 条药物（含 11 种未知药盲检）、5 条自主神经刺激通路、五通道图纸记录仪
- 原版 `.rat` 记录文件导入 / 导出互通、自动保存紧凑编码、PWA 离线（网页模式）

### 已知限制

- 默认 0.25× 回放速度为原版走纸节奏（时间轴为生理时间），可切换 1× / 2× / 5×
- 无代码签名（教学内网分发无碍）
- 大鼠死亡后心收缩力/心室压仍显示室颤波形（忠实复刻原版模型行为；可在「原理与设置」开启死亡后曲线拉平）
