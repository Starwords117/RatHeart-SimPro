#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// ============================================================
// RatHeart-SimPro 桌面壳(Tauri 试点版)
// 与 desktop/main.cjs(Electron 版)行为对齐:
// - 启动即监听 0.0.0.0:5189+,广播服务器内置(学生访问
//   http://<教学机IP>:<端口>/follow.html?room=)
// - 端口经 ?api= 传给页面,worker 直连 http://127.0.0.1:<端口> 推送
//   (v0.2.1 设计,网页层零改动)
// - 窗口 1360×900,最小 960×640,标题「大鼠心血管实验台」
// - save_export 命令:文件导出走原生保存对话框
//   (WKWebView/WebKitGTK 无 a[download],Blob 下载会静默失败)
// ============================================================
use base64::Engine;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// 与 Electron 版 findFreePort 同规则:从 5189 起探测空闲端口,上限 +20
fn find_free_port(start: u16) -> u16 {
    for p in start..start + 20 {
        if std::net::TcpListener::bind(("127.0.0.1", p)).is_ok() {
            return p;
        }
    }
    start
}

/// 广播服务器静态根:打包版取资源目录内 dist,开发版取仓库 dist
fn dist_root(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .resource_dir()
        .ok()
        .map(|d| d.join("dist"))
        .filter(|p| p.is_dir())
        .unwrap_or_else(|| std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist"))
}

/// 导出桥:前端 download() 在 Tauri 环境改走此命令(b64 编码),
/// 弹原生保存对话框后写盘。取消返回 Err("已取消")。
#[tauri::command]
async fn save_export(app: tauri::AppHandle, name: String, b64: String) -> Result<String, String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .map_err(|e| format!("数据解码失败:{e}"))?;
    // 阻塞对话框放线程池,避免占住异步运行时
    tauri::async_runtime::spawn_blocking(move || {
        let file = app
            .dialog()
            .file()
            .add_filter("实验记录 (json/rat)", &["json", "rat"])
            .add_filter("图片 (png)", &["png"])
            .add_filter("表格 (csv)", &["csv"])
            .set_file_name(&name)
            .blocking_save_file();
        match file {
            None => Err("已取消".to_string()),
            Some(path) => {
                let p = path.into_path().map_err(|e| e.to_string())?;
                std::fs::write(&p, &data).map_err(|e| format!("写入失败:{e}"))?;
                Ok(p.to_string_lossy().into_owned())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_export])
        .setup(|app| {
            let port = find_free_port(5189);
            let handle = app.handle().clone();
            let config = ratheart_server::ServerConfig {
                root: dist_root(&handle),
                port,
                host: "0.0.0.0".to_string(),
                open_lan: true,
            };
            tauri::async_runtime::spawn(async move {
                if let Err(e) = ratheart_server::serve(config).await {
                    eprintln!("局域网广播启动失败:{e}");
                    handle
                        .dialog()
                        .message(format!("局域网广播启动失败:\n{e}"))
                        .title("RatHeart-SimPro")
                        .blocking_show();
                }
            });
            // 端口经 ?api= 传给页面(与 Electron 版同机制)
            let url = WebviewUrl::App(std::path::PathBuf::from(format!("index.html?api={port}")));
            WebviewWindowBuilder::new(app, "main", url)
                .title("大鼠心血管实验台")
                .inner_size(1360.0, 900.0)
                .min_inner_size(960.0, 640.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("RatHeart-SimPro 启动失败");
}
