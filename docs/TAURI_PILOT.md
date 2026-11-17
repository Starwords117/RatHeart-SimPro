# Tauri 迁移试点报告（分支 tauri-pilot）

日期：2026-11-17 · 结论：**试点通过，建议全量迁移**（Windows 机房底线不变，见下文）

## 背景

评估把桌面版从 Electron 44 迁到 Tauri 2。两路审计结论：Electron API 面极小
（main.cjs 121 行、无 IPC 桥）、网页端零 Electron 专属代码、v0.2.1 的
worker 直连 `http://127.0.0.1:<端口>` + 服务器 CORS 恰是 Tauri 最稳模式。

## 试点范围与结果

| 验证项 | 结果 |
|---|---|
| 广播服务器 Rust 重写语义等价 | ✅ `crates/ratheart-server`（axum+tokio，约 700 行含注释），现有 `tests/broadcast-e2e.mjs` 9 项核验加 `--base` 参数后**原样跑在 Rust 服务器上 9/9 全绿**（房间隔离/token 403/SSE backfill/停止竞态 1.5s 忽略窗/多房间/GC） |
| 模块 Worker + 页面在 Tauri 跑 | ✅ debug/release/AppImage 三形态启动正常；`?api=<端口>` 机制原样工作，worker 直连回环推送零改动 |
| save_export 导出桥 | ✅ Rust command（base64 → 原生保存对话框 → 写盘）编译通过；`download()` 统一入口加 Tauri 分支覆盖全部 6 处导出 |
| 协议/SW 门控 | ✅ 3 处小改：index.html SW 注册跳过 Tauri（Windows 源是 `http://tauri.localhost` 会误命中）、`BROADCAST_CAPABLE` 加 `IN_TAURI`、注释同步 |
| Linux 打包 | ✅ **deb 3.62 MB**（Electron 同平台 95 MB，**缩小 26 倍**，且无需 fpm/libcrypt 补丁）；AppImage 110 MB 可构建可运行（见「发现」第 3 条） |
| 网页零回归 | ✅ tsc 清零；内核 49 项 + Worker 8 项核验通过；广播 9 项（CJS 路径）；Playwright 4/4（含全按钮巡游 17 步） |
| WebKitGTK 真机渲染 | ✅ AppImage 内嵌系统 webkit2gtk 2.54（Fedora 44）渲染正常、API 通信正常（模块 Worker/`<dialog>`/ResizeObserver 均为 Safari 15.4+ 等价特性，2.54 远高于要求） |

## 体积对比（Linux x86_64）

| 形态 | Electron | Tauri |
|---|---|---|
| deb（系统 webkit） | 95 MB | **3.6 MB** |
| AppImage（全捆绑 GUI 库） | 95 MB | 110 MB |

**Linux 分发建议以 deb/rpm 为主**（系统 webkit2gtk-4.1 为依赖，Debian 12+/Ubuntu 22.04+/Fedora 37+ 自带）；AppImage 无体积优势。Windows（NSIS/WebView2）预计 3–8 MB vs 现 ~100 MB。内存与启动速度亦显著占优。

## 发现的坑（迁移时要记住）

1. **Playwright 按钮"挂死"三连**（按钮巡游 E2E 曾三次卡死的真因）：
   - 导出按钮全部在 `<details class="export-menu">` 折叠菜单内——不展开 summary，按钮不可见，点击等待到超时（此前误判为"长轨迹快照慢"）；
   - 药物下拉 label 是**全角括号**「地高辛（Dig）」，`selectOption({label})` 半角匹配不到会无限等待——改用 value；
   - 死亡后模型锁定时不能用 `page.check()`（它要求选中状态成立），用 `click` + `not.toBeChecked()` 断言。
2. **`setInputFiles` 裸路径陷阱**：File.name 变成临时 UUID（无扩展名），应用按扩展名分流时走错分支——必须传 `{name, mimeType, buffer}`。
3. **AppImage 工具链在国内网络的坑**：linuxdeploy 三件套 GitHub 直连必超时/停滞，`ghfast.top` 镜像前缀可下载，缓存于 `~/.cache/tauri/`；appimagetool 本机运行需 `APPIMAGE_EXTRACT_AND_RUN=1`（否则 FUSE 挂死 0% CPU）。CI ubuntu runner 无此问题。
4. **本机 5189 端口曾被上次会话遗留的 Node 广播服务器占用**，导致端口顺延、冒烟请求打到旧服务器——冒烟前先 `ss -tlnp | grep 5189` 确认端口干净。
5. WebKitGTK 页面源为 `tauri://`，Windows 为 `http://tauri.localhost`：SW 注册必须用 `__TAURI_INTERNALS__` 判定排除，否则 SW 缓存会劫持 tauri 协议资产。

## 未验证项（需 CI 出包后真机验收）

- Windows：WebView2 下 a[download] 行为（导出桥是否被正确触发）、SmartScreen、防火墙弹窗、广播真机联调
- macOS：WKWebView 文件选择器（`<input type=file>`）、导出桥、模块 Worker（macOS 12+ 底线）
- 教室 Wi-Fi 真机：学生 follow 页经 Rust 服务器跟随

## 全量迁移待办（试点通过后）

1. CI：release.yml 改三平台 matrix（windows/macos/ubuntu runner + Rust 工具链），tauri-action 出包上传；AppImage 在 CI 原生构建
2. Windows/mac 打包配置（NSIS 中文向导、dmg——CI 上 hdiutil 可用，比现在 zip 更完整）
3. Electron 退役：删 desktop/、electron-builder.json、package.json 相关字段
4. 版本号同步点改造（tauri.conf.json 版本加入四处同步清单）
5. 图标：`tauri icon` 已生成全套（android/ios 已删）
6. Windows NSIS + macOS 真机验收清单执行
