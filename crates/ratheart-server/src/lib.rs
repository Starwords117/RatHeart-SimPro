// ============================================================
// RatHeart-SimPro 授课广播/静态服务器(Rust 版)
// 与 server/broadcast-server.cjs 语义逐项对齐,注释标注对应 CJS 行号。
// 多教师房间隔离 + 教师 token 所有权 + SSE 实时推送 + 轮询回退 +
// 停止竞态忽略窗 + 无跟随者 GC + 局域网主地址探测。
// 会话保存在进程内存,不落盘、不外发。
// ============================================================
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Query, State},
    http::{header, HeaderValue, Method, Request, StatusCode, Uri},
    response::sse::{Event, Sse},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures::Stream;
use percent_encoding::percent_decode_str;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    convert::Infallible,
    error::Error,
    net::UdpSocket,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime},
};
use tokio::sync::broadcast;
use tower::ServiceExt;

const MAX_BROADCAST_FRAMES: usize = 18_000; // 滚动窗口 15 分钟 @40 子样本/s(CJS 40)
const SESSION_GC_MS: u64 = 60_000; // 无跟随者且 60s 无更新 → 会话清除(CJS 41)
const STOP_IGNORE_MS: u64 = 1_500; // 停止广播后迟到推送忽略窗(CJS 125)
const BODY_LIMIT: usize = 8_000_000; // 对应 CJS 8e6 断连阈值(CJS 166/172)

/// SSE 通道消息:(事件名, data 文本)。backfill/chunk 两类。
type SseMsg = (&'static str, String);

pub struct ServerConfig {
    pub root: PathBuf,
    pub port: u16,
    pub host: String, // "127.0.0.1" 或 "0.0.0.0"(局域网授课)
    pub open_lan: bool,
}

struct Room {
    seq: u64,
    state: Option<Value>,
    frames: Vec<Value>,
    events: Vec<Value>,
    live: bool,
    total_abs: u64,
    token: Option<String>, // 建立会话的教师令牌;None 表示未设(兼容无 token 客户端, CJS 57)
    updated_at: u64,
    followers: broadcast::Sender<SseMsg>, // 每个学生 SSE 连接一个 Receiver(CJS followers: Set)
}

impl Room {
    fn new(token: Option<String>) -> Self {
        let (followers, _) = broadcast::channel(256);
        Self {
            seq: 0,
            state: None,
            frames: Vec::new(),
            events: Vec::new(),
            live: false,
            total_abs: 0,
            token,
            updated_at: 0,
            followers,
        }
    }

    /// CJS broadcastChunk(66-69):向全部跟随者写 `event: chunk\ndata: {...}\n\n`
    fn broadcast_chunk(&self, payload: &Value) {
        let data = serde_json::to_string(payload).unwrap_or_default();
        let _ = self.followers.send(("chunk", data));
    }
}

#[derive(Clone)]
pub struct AppState {
    rooms: Arc<Mutex<HashMap<String, Room>>>,
    /// 房间停止广播后的迟到推送忽略窗口(roomId → 忽略截止时刻 ms, CJS 47)
    recently_closed: Arc<Mutex<HashMap<String, u64>>>,
    config: Arc<ServerConfig>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---- 探测对外主 IP(CJS detectPrimaryIp 18-26) ----
// UDP connect 走一次路由选择(不发包),OS 给出默认路由对应的本机地址;
// 教室无外网/无默认路由时返回 None
pub fn detect_primary_ip() -> Option<String> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:53").ok()?;
    let ip = sock.local_addr().ok()?.ip();
    if ip.is_ipv4() && !ip.is_loopback() {
        Some(ip.to_string())
    } else {
        None
    }
}

// ---- 局域网 IPv4 地址(CJS 221-229 收集段) ----
fn lan_addresses(port: u16) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(addrs) = if_addrs::get_if_addrs() {
        for a in addrs {
            if let if_addrs::IfAddr::V4(v4) = a.addr {
                if !v4.ip.is_loopback() {
                    out.push(format!("http://{}:{port}", v4.ip));
                }
            }
        }
    }
    // 教学 Wi-Fi 网段排前,虚拟/桥接网卡地址殿后(稳定排序,同 CJS)
    out.sort_by_key(|s| {
        if s.contains("192.168.") {
            0
        } else if s.contains("10.") {
            1
        } else if s.contains("172.") {
            2
        } else {
            3
        }
    });
    out
}

// ---- JS Number 语义的查询参数解析 ----
// Math.max(0, Number(x ?? 默认) || 0):空串/非数字 → 0,负数截到 0(CJS 185-186)
fn num_param(params: &HashMap<String, String>, key: &str, default: f64) -> f64 {
    match params.get(key) {
        Some(s) => s.trim().parse::<f64>().unwrap_or(0.0).max(0.0),
        None => default,
    }
}

fn json_res(status: StatusCode, v: Value) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        Json(v),
    )
        .into_response()
}

fn text_res(status: StatusCode, body: &'static str) -> Response {
    (status, body).into_response()
}

// ============================================================
// 路由(CJS 147-255)
// ============================================================
pub fn router(config: ServerConfig) -> Router {
    let state = build_state(config);
    spawn_gc(state.clone());
    routes(state)
}

/// 构建共享状态(Tauri 进程内调用通道与 TCP 服务器共用同一份房间数据)
pub fn build_state(config: ServerConfig) -> AppState {
    AppState {
        rooms: Arc::new(Mutex::new(HashMap::new())),
        recently_closed: Arc::new(Mutex::new(HashMap::new())),
        config: Arc::new(config),
    }
}

/// 用既有状态构建路由(Tauri api_call 经 oneshot 复用同一套路由)
pub fn routes(state: AppState) -> Router {
    Router::new()
        .route("/api/broadcast", post(broadcast))
        .route("/api/broadcast-off", post(broadcast_off))
        .route("/api/follow", get(follow))
        .route("/api/poll", get(poll))
        .route("/api/session", get(session))
        .route("/api/lan", get(lan))
        .fallback(static_file)
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(axum::middleware::from_fn(cors))
        .with_state(state)
}

// CORS:桌面版页面/worker 直连 http 回环推送(跨源)(CJS 151-162)
async fn cors(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let is_api = req.uri().path().starts_with("/api/");
    let is_options = req.method() == Method::OPTIONS;
    let mut res = next.run(req).await;
    if is_api {
        // Access-Control-Allow-Private-Network:新版 Chromium(WebView2)与 WebKit
        // 对「私网源 → 本机回环」启用 PNA/LNA 拦截,预检/响应缺此头会被直接以
        // Load failed / Failed to fetch 拒绝——桌面版广播首次失败的原因
        let h = res.headers_mut();
        h.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        );
        h.insert(
            header::HeaderName::from_static("access-control-allow-private-network"),
            HeaderValue::from_static("true"),
        );
        if is_options {
            let mut pre = StatusCode::NO_CONTENT.into_response();
            let ph = pre.headers_mut();
            ph.insert(
                header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static("GET,POST,OPTIONS"),
            );
            ph.insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static("content-type"),
            );
            ph.insert(
                header::HeaderName::from_static("access-control-allow-private-network"),
                HeaderValue::from_static("true"),
            );
            return pre;
        }
    }
    res
}

// 教师推送(CJS handleBroadcast 71-108)
async fn broadcast(State(app): State<AppState>, body: String) -> Response {
    let message: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return text_res(StatusCode::BAD_REQUEST, "Bad JSON"),
    };
    let Some(room) = message.get("room").and_then(|v| v.as_str()).map(String::from)
    else {
        return text_res(StatusCode::BAD_REQUEST, "Missing room");
    };
    let token = message.get("token").and_then(|v| v.as_str()).map(String::from);

    // 停止广播后到达的在途推送:静默忽略,防止会话被重建(CJS 76-80)
    if app
        .recently_closed
        .lock()
        .unwrap()
        .get(&room)
        .copied()
        .unwrap_or(0)
        > now_ms()
    {
        return json_res(StatusCode::OK, json!({ "ok": true, "followers": 0 }));
    }

    let followers = {
        let mut rooms = app.rooms.lock().unwrap();
        let s = match rooms.get_mut(&room) {
            None => {
                rooms.insert(room.clone(), Room::new(token.clone()));
                rooms.get_mut(&room).unwrap()
            }
            Some(s) => {
                // 所有权校验:会话已有 token 则必须匹配(CJS 62)
                if s.token.is_some() && s.token != token {
                    return text_res(StatusCode::FORBIDDEN, "Forbidden");
                }
                s
            }
        };
        let kind = message.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match kind {
            "full" => {
                s.seq = message
                    .get("seq")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(s.seq + 1);
                s.frames = message
                    .get("frames")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        let start = a.len().saturating_sub(MAX_BROADCAST_FRAMES);
                        a[start..].to_vec()
                    })
                    .unwrap_or_default();
                s.events = message
                    .get("events")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                s.state = message.get("state").cloned().filter(|v| !v.is_null());
                s.total_abs = s.frames.len() as u64;
            }
            "chunk" => {
                if let Some(frames) = message.get("frames").and_then(|v| v.as_array()) {
                    s.frames.extend(frames.iter().cloned());
                    s.total_abs += frames.len() as u64;
                    if s.frames.len() > MAX_BROADCAST_FRAMES {
                        let excess = s.frames.len() - MAX_BROADCAST_FRAMES;
                        s.frames.drain(0..excess);
                    }
                }
                if let Some(events) = message.get("events").and_then(|v| v.as_array()) {
                    s.events.extend(events.iter().cloned());
                }
                if message.get("state").map(|v| !v.is_null()).unwrap_or(false) {
                    s.state = message.get("state").cloned();
                }
            }
            _ => return text_res(StatusCode::BAD_REQUEST, "Unknown type"),
        }
        s.live = true;
        s.updated_at = now_ms();
        // 供跟随端陈旧判定(CJS 104)
        let mut payload = message.clone();
        payload["updatedAt"] = Value::from(s.updated_at);
        let followers = s.followers.receiver_count();
        s.broadcast_chunk(&payload);
        followers
    };
    json_res(StatusCode::OK, json!({ "ok": true, "followers": followers }))
}

// 停止广播(CJS handleBroadcastOff 110-128)
async fn broadcast_off(State(app): State<AppState>, body: String) -> Response {
    let message: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return text_res(StatusCode::BAD_REQUEST, "Bad JSON"),
    };
    let Some(room) = message.get("room").and_then(|v| v.as_str()).map(String::from)
    else {
        return text_res(StatusCode::BAD_REQUEST, "Missing room");
    };
    let token = message.get("token").and_then(|v| v.as_str()).map(String::from);

    let mut rooms = app.rooms.lock().unwrap();
    let Some(s) = rooms.get_mut(&room) else {
        return json_res(StatusCode::OK, json!({ "ok": true }));
    };
    if s.token.is_some() && s.token != token {
        return text_res(StatusCode::FORBIDDEN, "Forbidden");
    }
    s.live = false;
    s.state = None;
    s.frames.clear();
    s.events.clear();
    s.updated_at = now_ms();
    s.seq += 1;
    s.broadcast_chunk(&json!({ "type": "off" }));
    rooms.remove(&room);
    drop(rooms);
    app.recently_closed
        .lock()
        .unwrap()
        .insert(room, now_ms() + STOP_IGNORE_MS);
    json_res(StatusCode::OK, json!({ "ok": true }))
}

// 学生 SSE 实时跟随(CJS handleFollow 130-145):
// 锁内先 subscribe 再快照 backfill(保证不漏订阅瞬间到达的 chunk),
// 先发 backfill,再常驻推 chunk,15s 心跳;房间删除后保连接只发心跳(同 CJS)
async fn follow(
    State(app): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(room) = params.get("room").cloned() else {
        return text_res(StatusCode::BAD_REQUEST, "Missing room");
    };
    let snapshot: Option<(broadcast::Receiver<SseMsg>, String)> = {
        let rooms = app.rooms.lock().unwrap();
        rooms.get(&room).map(|s| {
            let rx = s.followers.subscribe();
            let backfill = json!({
                "seq": s.seq,
                "state": s.state,
                "frames": s.frames,
                "events": s.events
            });
            (rx, backfill.to_string())
        })
    };
    let (rx, backfill) = match snapshot {
        Some((rx, backfill)) => (Some(rx), backfill),
        // 房间不存在:照 CJS 发空 backfill,不加入跟随者
        None => (
            None,
            json!({ "seq": 0, "state": Value::Null, "frames": [], "events": [] }).to_string(),
        ),
    };
    let stream = follow_stream(rx, backfill, app.clone(), room);
    let mut res = Sse::new(stream).into_response();
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-transform"),
    );
    res
}

struct FollowState {
    rx: Option<broadcast::Receiver<SseMsg>>,
    app: AppState,
    room: String,
    pending: Option<Event>, // 流首项:backfill
    heartbeat: Pin<Box<tokio::time::Sleep>>,
}

/// Lagged(慢跟随者丢帧)恢复:合成教师式 type:'full' 快照,
/// 客户端 applyUpdate(reset=true) 整体重置——等价教师重推全量窗口。
fn room_full_snapshot(app: &AppState, room: &str) -> Option<String> {
    let rooms = app.rooms.lock().unwrap();
    rooms.get(room).map(|s| {
        json!({
            "type": "full",
            "seq": s.seq,
            "state": s.state,
            "frames": s.frames,
            "events": s.events
        })
        .to_string()
    })
}

fn follow_stream(
    rx: Option<broadcast::Receiver<SseMsg>>,
    backfill: String,
    app: AppState,
    room: String,
) -> impl Stream<Item = Result<Event, Infallible>> {
    futures::stream::unfold(
        FollowState {
            rx,
            app,
            room,
            pending: Some(Event::default().event("backfill").data(backfill)),
            heartbeat: Box::pin(tokio::time::sleep(Duration::from_secs(15))),
        },
        |mut st| async move {
            loop {
                if let Some(ev) = st.pending.take() {
                    return Some((Ok(ev), st));
                }
                match &mut st.rx {
                    Some(rx) => {
                        tokio::select! {
                            msg = rx.recv() => match msg {
                                Ok((event, data)) => {
                                    return Some((Ok(Event::default().event(event).data(data)), st));
                                }
                                Err(broadcast::error::RecvError::Lagged(_)) => {
                                    // 慢跟随者丢帧:发当前全量快照让学生端整体重置(不断连接、不降级轮询)
                                    match room_full_snapshot(&st.app, &st.room) {
                                        Some(full) => {
                                            return Some((Ok(Event::default().event("chunk").data(full)), st));
                                        }
                                        // 房间刚被删:转纯心跳模式
                                        None => st.rx = None,
                                    }
                                }
                                // 房间已删(教师停止):同 CJS,连接保留、只发心跳
                                Err(broadcast::error::RecvError::Closed) => {
                                    st.rx = None;
                                }
                            },
                            _ = &mut st.heartbeat => {
                                st.heartbeat = Box::pin(tokio::time::sleep(Duration::from_secs(15)));
                                return Some((Ok(Event::default().comment("ping")), st));
                            }
                        }
                    }
                    None => {
                        (&mut st.heartbeat).await;
                        st.heartbeat = Box::pin(tokio::time::sleep(Duration::from_secs(15)));
                        return Some((Ok(Event::default().comment("ping")), st));
                    }
                }
            }
        },
    )
}

// ---- 学生轮询(CJS /api/poll 182-206) ----
async fn poll(
    State(app): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let room = params.get("room").cloned().unwrap_or_default();
    let f = num_param(&params, "f", 0.0);
    let e = num_param(&params, "e", 0.0);
    let seq_q = num_param(&params, "seq", -1.0);

    let rooms = app.rooms.lock().unwrap();
    let s = rooms.get(&room);
    let (seq, state, frames_len, events_len, total_abs, updated_at) = match s {
        Some(s) => (
            s.seq,
            s.state.clone(),
            s.frames.len(),
            s.events.len(),
            s.total_abs,
            s.updated_at,
        ),
        None => (0, None, 0, 0, 0, 0),
    };
    let window_start = if s.is_some() {
        total_abs.saturating_sub(frames_len as u64)
    } else {
        0
    };
    let seq_match = seq_q == seq as f64;
    let in_range = s.is_some()
        && f >= window_start as f64
        && f <= total_abs as f64
        && e <= events_len as f64;
    let reset = s.is_none() || !seq_match || !in_range;
    let rel_f = (f - window_start as f64).max(0.0).floor() as usize;
    let ei = (e as usize).min(events_len);
    let body = json!({
        "seq": seq,
        "reset": reset,
        "state": state,
        "frames": if reset {
            s.map(|x| x.frames.clone()).unwrap_or_default()
        } else {
            s.map(|x| x.frames[rel_f.min(x.frames.len())..].to_vec()).unwrap_or_default()
        },
        "events": if reset {
            s.map(|x| x.events.clone()).unwrap_or_default()
        } else {
            s.map(|x| x.events[ei..].to_vec()).unwrap_or_default()
        },
        "totalAbs": total_abs,
        "windowStart": window_start,
        "totalF": frames_len,
        "totalE": events_len,
        "updatedAt": updated_at
    });
    drop(rooms);
    let mut res = json_res(StatusCode::OK, body);
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    res
}

// ---- 会话概要(CJS /api/session 207-218):主页 10s 轮询判断是否在广播 ----
async fn session(
    State(app): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let room = params.get("room");
    let rooms = app.rooms.lock().unwrap();
    let s = room.and_then(|r| rooms.get(r));
    json_res(
        StatusCode::OK,
        json!({
            "live": s.map(|x| x.live && x.state.is_some()).unwrap_or(false),
            "followers": s.map(|x| x.followers.receiver_count()).unwrap_or(0),
            "updatedAt": s.map(|x| x.updated_at).unwrap_or(0),
            "tissue": s.and_then(|x| x.state.as_ref())
                .and_then(|st| st.get("tissue"))
                .cloned()
                .unwrap_or(Value::Null)
        }),
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LanInfo {
    lan: bool,
    port: u16,
    addresses: Vec<String>,
    primary: Option<String>,
    follow: Vec<String>,
    primary_follow: Option<String>,
}

// ---- 局域网地址(CJS /api/lan 220-240):前端据此提示学生访问地址 ----
async fn lan(State(app): State<AppState>) -> Response {
    let port = app.config.port;
    let addresses = lan_addresses(port);
    let primary_ip = tokio::task::spawn_blocking(detect_primary_ip)
        .await
        .unwrap_or(None);
    let primary = primary_ip
        .filter(|ip| addresses.iter().any(|a| a.contains(ip)))
        .map(|ip| format!("http://{ip}:{port}"));
    json_res(
        StatusCode::OK,
        serde_json::to_value(LanInfo {
            lan: app.config.open_lan,
            port,
            addresses: addresses.clone(),
            follow: addresses.iter().map(|a| format!("{a}/follow.html")).collect(),
            primary_follow: primary.as_ref().map(|p| format!("{p}/follow.html")),
            primary,
        })
        .unwrap_or(Value::Null),
    )
}

// ---- 静态文件(CJS 242-254):学生浏览器靠它拉 follow.html ----
async fn static_file(State(app): State<AppState>, uri: Uri) -> Response {
    let decoded = percent_decode_str(uri.path())
        .decode_utf8_lossy()
        .to_string();
    let relative = safe_relative(&decoded);
    let root: &Path = &app.config.root;
    let file = if relative.is_empty() {
        root.join("index.html")
    } else {
        root.join(&relative)
    };
    if !file.starts_with(root) {
        return text_res(StatusCode::FORBIDDEN, "Forbidden");
    }
    match tokio::fs::read(&file).await {
        Ok(body) => {
            let mime = mime_for(&file);
            let mut res = (StatusCode::OK, [(header::CONTENT_TYPE, mime)], body).into_response();
            if file.ends_with("sw.js") {
                res.headers_mut()
                    .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
            }
            res
        }
        Err(_) => text_res(StatusCode::NOT_FOUND, "Not found"),
    }
}

// posix.normalize('/' + pathname) 等价:拆段消 ".."/".",防目录穿越(CJS 243)
fn safe_relative(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn mime_for(file: &Path) -> &'static str {
    match file.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json; charset=utf-8",
        "png" => "image/png",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

// ---- GC(CJS 257-267):教师页直接关闭/刷新未点停止时清理残留会话 ----
fn spawn_gc(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30));
        loop {
            tick.tick().await;
            let now = now_ms();
            let mut rooms = state.rooms.lock().unwrap();
            rooms.retain(|_, s| {
                !(s.live
                    && s.followers.receiver_count() == 0
                    && now.saturating_sub(s.updated_at) > SESSION_GC_MS)
            });
            drop(rooms);
            state
                .recently_closed
                .lock()
                .unwrap()
                .retain(|_, deadline| *deadline >= now);
        }
    });
}

// ---- 对外入口 ----
pub async fn serve(config: ServerConfig) -> Result<(), Box<dyn Error>> {
    let port = config.port;
    let host = config.host.clone();
    let app = router(config);
    serve_on(host, port, app).await
}

/// 用既有路由启动 TCP 服务(Tauri 进程内调用与 TCP 共享同一份状态)
pub async fn serve_on(host: String, port: u16, app: Router) -> Result<(), Box<dyn Error>> {
    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

/// 进程内调用:不经网络栈直接过 axum 路由。
/// 桌面版页面/worker 对本机回环的 fetch 会被 WebView 的
/// 私网访问限制(PNA/LNA)在进 TCP 之前拦掉,故桌面壳走此通道。
pub async fn call_api(
    state: &AppState,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> (u16, String) {
    let router = routes(state.clone());
    let uri: Uri = match path.parse() {
        Ok(u) => u,
        Err(_) => return (400, "Bad path".into()),
    };
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::ORIGIN, "tauri://localhost");
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    let req = match builder.body(Body::from(body.unwrap_or_default().to_string())) {
        Ok(r) => r,
        Err(_) => return (400, "Bad request".into()),
    };
    match router.oneshot(req).await {
        Ok(res) => {
            let status = res.status().as_u16();
            match axum::body::to_bytes(res.into_body(), BODY_LIMIT).await {
                Ok(bytes) => (status, String::from_utf8_lossy(&bytes).into_owned()),
                Err(e) => (500, format!("body read: {e}")),
            }
        }
        Err(e) => (500, format!("router: {e}")),
    }
}
