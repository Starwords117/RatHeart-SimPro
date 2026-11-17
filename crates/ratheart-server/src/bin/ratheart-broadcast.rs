// ============================================================
// 独立广播服务器二进制(与 server/broadcast-server.cjs 的 web CLI
// 用法对齐):教师机无 Node 环境时也能开课。
// 用法:ratheart-broadcast [--root <dist目录>] [--port <端口>] [--lan]
// 默认:./dist,端口 5189,仅绑 127.0.0.1;--lan 绑 0.0.0.0 并开放
// 局域网地址提示(学生直接访问 http://<教学机IP>:<端口>/follow.html?room=)。
// ============================================================
#[tokio::main]
async fn main() {
    let mut root = std::path::PathBuf::from("dist");
    let mut port: u16 = 5189;
    let mut lan = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => {
                root = args.next().map(std::path::PathBuf::from).unwrap_or(root);
            }
            "--port" => {
                port = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(port);
            }
            "--lan" => lan = true,
            other => {
                eprintln!("未知参数 {other};用法:ratheart-broadcast [--root <dir>] [--port <n>] [--lan]");
                std::process::exit(2);
            }
        }
    }
    let host = if lan { "0.0.0.0" } else { "127.0.0.1" };
    let config = ratheart_server::ServerConfig {
        root: root.canonicalize().unwrap_or(root),
        port,
        host: host.to_string(),
        open_lan: lan,
        embedded: None,
    };
    println!("RatHeart-SimPro 广播服务器:http://{host}:{port}(静态根 {})", config.root.display());
    if let Err(e) = ratheart_server::serve(config).await {
        eprintln!("服务器启动失败:{e}");
        std::process::exit(1);
    }
}
