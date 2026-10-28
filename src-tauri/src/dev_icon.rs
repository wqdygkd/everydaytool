// 开发态（debug 构建，即 `pnpm dev`）的窗口图标：带 DEV 底边带的那份，
// 同机并存时和安装版一眼分开。素材由 `scripts/make-dev-icon.py` 生成到
// `src-tauri/icons/dev/`（不参与打包：tauri.conf.json 的 bundle.icon 不含它）。
//
// 平台差异：`Window::set_icon` 在 Windows / Linux 生效（窗口 + 任务栏）；
// macOS 的 Dock 图标由 app bundle 决定，Tauri 2 没有等价于 Electron `app.dock.setIcon` 的 API，
// 开发态 Dock 图标沿用宿主进程默认图标——这是唯一没有复刻过去的一处，见 AGENTS.md。
#![cfg(dev)]

use tauri::WebviewWindow;

/// 素材直接编进二进制：开发态也不依赖仓库相对路径（cargo 可能从任意 cwd 运行）。
/// 用**裸 RGBA**而不是 PNG：桌面壳不带图片解码器（那要多背一个 image 依赖），
/// 而窗口图标本来就只需要一张位图；尺寸与生成脚本 `scripts/make-dev-icon.py` 对应。
const DEV_ICON_RGBA: &[u8] = include_bytes!("../icons/dev/icon-dev-132.rgba");
const DEV_ICON_SIDE: u32 = 132;

/// 给主窗口套上开发态图标；素材尺寸对不上时不阻断启动，只是回到默认图标。
pub fn apply(window: &WebviewWindow) {
    let expected = (DEV_ICON_SIDE as usize).pow(2) * 4;
    if DEV_ICON_RGBA.len() != expected {
        log::warn!(
            "[dev-icon] 开发态图标尺寸不符（期望 {expected} 字节，实际 {}），跳过",
            DEV_ICON_RGBA.len()
        );
        return;
    }
    let icon = tauri::image::Image::new(DEV_ICON_RGBA, DEV_ICON_SIDE, DEV_ICON_SIDE);
    if let Err(error) = window.set_icon(icon) {
        log::warn!("[dev-icon] 设置开发态窗口图标失败：{error}");
    }
}

/// 启动时打一行 profile 日志：两种形态同时运行时，日志里要能一眼看出这条来自哪个 profile。
pub fn log_profile(app: &tauri::AppHandle) {
    log::info!(
        "[profile] 开发态实例：userData = {}，dataDirectory = {}",
        crate::appearance::resolve_user_data_dir(app).display(),
        crate::appearance::resolve_data_dir().display()
    );
}
