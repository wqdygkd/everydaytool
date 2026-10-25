// interceptor 域：Rust 原生实现（origin / 存储 / 证书 / 信任 / 规则引擎 / WS 桥 / 流量 / MITM 代理 / 服务装配）。
pub mod ca_trust;
pub mod certs;
mod key_guard;
pub mod origin;
pub mod paths;
pub mod proxy;
pub mod rule_engine;
pub mod script_compile;
pub mod service;
pub mod store;
pub mod traffic;
pub mod ws_bridge;

use serde_json::Value;

/// 下发给扩展的代理端口（hello-ok 用）
pub fn proxy_port_hint() -> Option<u16> {
    proxy::port()
}

/// 命令分发入口（commands.rs 调用）
pub fn handle(app: &tauri::AppHandle, command: &str, args: &[Value]) -> Result<Value, String> {
    service::handle(app, command, args)
}

/// 应用启动后初始化（lib.rs setup 调用）
pub fn setup(app: &tauri::AppHandle) {
    service::setup(app);
}

/// 数据目录变更后重载（app 域命令调用）
pub fn on_data_directory_changed(app: &tauri::AppHandle) {
    service::on_data_directory_changed(app);
}

/// 退出清理
pub fn dispose() {
    service::dispose();
}
