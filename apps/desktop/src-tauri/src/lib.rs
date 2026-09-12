use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, Url, WindowEvent};

#[derive(Default)]
struct ServerState(Mutex<Option<Child>>);

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/Users/Shared"))
}

fn find_node() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("YIYABO_NODE") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    // Absolute paths first — Finder-launched apps have a minimal PATH
    let home = home_dir();
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
        home.join(".local/bin/node"),
        home.join(".volta/bin/node"),
        home.join(".nvm/current/bin/node"),
        home.join(".fnm/current/bin/node"),
    ];
    // shallow nvm versions
    let nvm_versions = home.join(".nvm/versions/node");
    if let Ok(rd) = std::fs::read_dir(&nvm_versions) {
        let mut vers: Vec<PathBuf> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path().join("bin/node"))
            .filter(|p| p.exists())
            .collect();
        vers.sort();
        vers.reverse();
        candidates.extend(vers);
    }
    for c in candidates {
        if c.exists() {
            return Some(c);
        }
    }
    if let Ok(out) = Command::new("which").arg("node").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(PathBuf::from(s));
            }
        }
    }
    None
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(39217)
}

fn server_web_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        let root = res.join("server");
        candidates.push(root.join("apps/web"));
        candidates.push(root);
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src-tauri/server-dist/apps/web"));
        candidates.push(cwd.join("server-dist/apps/web"));
    }
    candidates.into_iter().find(|c| c.join("server.js").exists())
}

fn server_root_from_web(web: &PathBuf) -> PathBuf {
    web.parent()
        .and_then(|p| if p.ends_with("apps") { p.parent() } else { Some(p) })
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| web.clone())
}

fn app_data_dir(app: &AppHandle) -> Option<PathBuf> {
    let d = app.path().app_local_data_dir().ok()?;
    std::fs::create_dir_all(&d).ok()?;
    Some(d)
}

fn wait_for_http(url: &str, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if let Ok(out) = Command::new("curl")
            .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "2", url])
            .output()
        {
            let code = String::from_utf8_lossy(&out.stdout);
            if code.starts_with('2') || code.starts_with('3') || code == "404" {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

fn spawn_server(app: &AppHandle) -> Result<(Child, String, PathBuf), String> {
    let node = find_node()
        .ok_or_else(|| "未找到 Node.js。请安装 Node 20+，或设置环境变量 YIYABO_NODE。".to_string())?;
    let web = server_web_dir(app)
        .ok_or_else(|| "应用资源中未找到内置服务 (server/apps/web/server.js)。".to_string())?;
    let data = app_data_dir(app).ok_or_else(|| "无法定位应用数据目录。".to_string())?;

    let storage = data.join("storage");
    let logs = data.join("logs");
    std::fs::create_dir_all(&storage).ok();
    std::fs::create_dir_all(&logs).ok();

    let db_path = data.join("yiyabo.db");
    if !db_path.exists() {
        let root = server_root_from_web(&web);
        for tpl in [
            root.join("yiyabo-template.db"),
            web.join("yiyabo-template.db"),
            root.join("apps/web/yiyabo-template.db"),
        ] {
            if tpl.exists() {
                match std::fs::copy(&tpl, &db_path) {
                    Ok(_) => eprintln!("[yiyabo] initialized db from template"),
                    Err(e) => eprintln!("[yiyabo] copy template db failed: {e}"),
                }
                break;
            }
        }
    }
    let db_url = format!("file:{}", db_path.display());

    let port = free_port();
    let host = "127.0.0.1";
    let url = format!("http://{}:{}", host, port);

    let log_path = logs.join("server.log");
    let log_file =
        std::fs::File::create(&log_path).map_err(|e| format!("无法写日志: {e}"))?;
    let log_err = log_file.try_clone().map_err(|e| format!("clone log: {e}"))?;

    let mut cmd = Command::new(&node);
    cmd.arg(web.join("server.js"))
        .current_dir(&web)
        .env("PORT", port.to_string())
        .env("HOSTNAME", host)
        .env("DESKTOP_MODE", "1")
        .env("NODE_ENV", "production")
        .env("DATABASE_URL", &db_url)
        .env("LOCAL_STORAGE_ROOT", storage.as_os_str())
        .env("AUTH_SECRET", "yiyabo-desktop-local-secret")
        .env("NEXTAUTH_SECRET", "yiyabo-desktop-local-secret")
        .env("NEXTAUTH_URL", &url)
        .env("AUTH_URL", &url)
        .env("AI_PROVIDER", "mock")
        // Make sibling node_modules visible
        .env(
            "NODE_PATH",
            web.join("node_modules")
                .to_string_lossy()
                .to_string(),
        )
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err));

    eprintln!("[yiyabo] starting {} cwd={}", node.display(), web.display());
    let child = cmd.spawn().map_err(|e| format!("启动 node 失败: {e}"))?;

    let ready = wait_for_http(&format!("{}/api/app-info", url), Duration::from_secs(40));
    if !ready {
        let tail = std::fs::read_to_string(&log_path)
            .unwrap_or_default()
            .chars()
            .rev()
            .take(1500)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>();
        return Err(format!(
            "本地服务未能在 40 秒内就绪。\n日志: {}\n\n{}",
            log_path.display(),
            tail
        ));
    }

    Ok((child, url, log_path))
}

fn show_error(win: &tauri::WebviewWindow, msg: &str) {
    let escaped = msg
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "<br/>");
    let html = format!(
        r#"document.body.innerHTML = '<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:48px;max-width:640px;line-height:1.6"><h1 style="margin:0 0 12px">yiyabo</h1><p style="color:#b91c1c">无法启动本地服务</p><pre style="white-space:pre-wrap;background:#f5f5f4;padding:12px;border-radius:8px;font-size:12px">{escaped}</pre><p style="color:#666">请确认已安装 Node.js 20+。日志目录：~/Library/Application Support/com.yiyabo.desktop/logs/</p></div>';"#
    );
    let _ = win.eval(&html);
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ServerState::default())
        .invoke_handler(tauri::generate_handler![app_version])
        .setup(|app| {
            let handle = app.handle().clone();
            let win = app.get_webview_window("main");
            let is_dev = cfg!(debug_assertions);

            if is_dev {
                if let Some(w) = &win {
                    let _ = w.set_title("yiyabo");
                    let _ = w.show();
                }
                return Ok(());
            }

            match spawn_server(&handle) {
                Ok((child, url, _log)) => {
                    if let Some(state) = handle.try_state::<ServerState>() {
                        *state.0.lock().unwrap() = Some(child);
                    }
                    if let Some(w) = &win {
                        let _ = w.set_title("yiyabo");
                        match Url::parse(&url) {
                            Ok(u) => {
                                let _ = w.navigate(u);
                            }
                            Err(e) => {
                                show_error(w, &format!("URL 解析失败: {e} ({url})"));
                                return Ok(());
                            }
                        }
                        // Give the webview a beat to load, then show
                        std::thread::sleep(Duration::from_millis(400));
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                Err(err) => {
                    eprintln!("[yiyabo] server start failed: {err}");
                    if let Some(w) = &win {
                        show_error(w, &err);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|_w, event| {
            if let WindowEvent::Destroyed = event {
                // cleanup on app exit via RunEvent::Exit
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build yiyabo")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<ServerState>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}
