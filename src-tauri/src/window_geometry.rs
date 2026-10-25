// 主窗口几何记忆：下次启动还原上次关闭时的窗口大小 / 位置 / 最大化状态。
// 数据契约：
//   - 配置文件：<数据目录>/window-geometry.json（与 window-appearance.json 同处，跟着数据目录走）
//   - 字段：width / height / x / y / maximized，尺寸与坐标一律逻辑像素（换 DPI 屏仍然合理）
//   - 还原前用当前显示器列表校验：窗口跑到屏幕外（拔屏 / 改分辨率 / 缩放变化）时夹回最近的显示器；
//     尺寸不超过整个桌面范围；拿不到显示器信息时保留原值，交给系统处理。
//   - 最大化 / 全屏 / 最小化时窗口报告的尺寸不是「正常态」几何，只更新 maximized 标记，
//     不覆盖上一次正常态的大小与位置（下次还原最大化后还原窗口仍是原来的位置）。
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Monitor, Window};

use crate::appearance;

const FILE_NAME: &str = "window-geometry.json";

pub const DEFAULT_WIDTH: f64 = 1200.0;
pub const DEFAULT_HEIGHT: f64 = 900.0;
/// 与 WebviewWindowBuilder 的 min_inner_size 保持一致。
pub const MIN_WIDTH: f64 = 800.0;
pub const MIN_HEIGHT: f64 = 500.0;
/// 配置文件被手改坏时的尺寸上限（不要把荒唐值传进系统）。
const MAX_WIDTH: f64 = 16_384.0;
const MAX_HEIGHT: f64 = 16_384.0;
/// 窗口至少要有这么多逻辑像素落在某块显示器内，否则视为坐标失效。
const MIN_VISIBLE: f64 = 96.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowGeometry {
    #[serde(default = "default_width")]
    pub width: f64,
    #[serde(default = "default_height")]
    pub height: f64,
    /// 窗口左上角坐标（逻辑像素），首次运行没有存档时为 None → 居中。
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub maximized: bool,
}

fn default_width() -> f64 {
    DEFAULT_WIDTH
}

fn default_height() -> f64 {
    DEFAULT_HEIGHT
}

impl Default for WindowGeometry {
    fn default() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            x: None,
            y: None,
            maximized: false,
        }
    }
}

impl WindowGeometry {
    /// 位置是否给了（两个坐标都要有才落位，否则交给 `.center()`）。
    pub fn position(&self) -> Option<(f64, f64)> {
        Some((self.x?, self.y?))
    }

    fn sanitized(self) -> Self {
        Self {
            width: finite_or(self.width, DEFAULT_WIDTH).clamp(MIN_WIDTH, MAX_WIDTH),
            height: finite_or(self.height, DEFAULT_HEIGHT).clamp(MIN_HEIGHT, MAX_HEIGHT),
            x: self.x.filter(|value| value.is_finite()),
            y: self.y.filter(|value| value.is_finite()),
            maximized: self.maximized,
        }
    }
}

fn finite_or(value: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

/// 显示器可见区域（逻辑像素）。
#[derive(Debug, Clone, Copy)]
struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Area {
    fn right(&self) -> f64 {
        self.x + self.width
    }

    fn bottom(&self) -> f64 {
        self.y + self.height
    }

    fn center(&self) -> (f64, f64) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }
}

pub fn load(app: &AppHandle) -> WindowGeometry {
    for path in appearance::config_read_paths(app, FILE_NAME) {
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        if let Ok(geometry) = serde_json::from_value::<WindowGeometry>(value) {
            return geometry.sanitized();
        }
    }
    WindowGeometry::default()
}

pub fn save(app: &AppHandle, geometry: &WindowGeometry) -> Result<(), String> {
    let path: PathBuf = appearance::config_write_path(app, FILE_NAME);
    let body = serde_json::to_string_pretty(geometry).map_err(|e| e.to_string())?;
    appearance::write_json_atomic(&path, &format!("{body}\n"))
}

/// 启动时把存档几何夹进当前显示器范围（尺寸不超整个桌面、位置保证可见）。
pub fn resolve(app: &AppHandle, geometry: WindowGeometry) -> WindowGeometry {
    let areas = app
        .available_monitors()
        .map(|monitors| monitor_areas(&monitors))
        .unwrap_or_default();
    resolve_with(geometry, &areas)
}

fn resolve_with(geometry: WindowGeometry, areas: &[Area]) -> WindowGeometry {
    let mut resolved = geometry.sanitized();
    if areas.is_empty() {
        // 拿不到显示器信息（远程会话 / 权限受限）：保留原值，交给系统处理
        return resolved;
    }
    // 尺寸上限取全部显示器的并集范围：允许跨屏窗口，但不允许超过整个桌面
    let left = areas.iter().map(|area| area.x).fold(f64::MAX, f64::min);
    let right = areas
        .iter()
        .map(|area| area.right())
        .fold(f64::MIN, f64::max);
    let top = areas.iter().map(|area| area.y).fold(f64::MAX, f64::min);
    let bottom = areas
        .iter()
        .map(|area| area.bottom())
        .fold(f64::MIN, f64::max);
    resolved.width = resolved.width.min((right - left).max(MIN_WIDTH));
    resolved.height = resolved.height.min((bottom - top).max(MIN_HEIGHT));
    if let (Some(x), Some(y)) = (resolved.x, resolved.y) {
        let (x, y) = place_on_screen(x, y, resolved.width, resolved.height, areas);
        resolved.x = Some(x);
        resolved.y = Some(y);
    }
    resolved
}

fn monitor_areas(monitors: &[Monitor]) -> Vec<Area> {
    monitors
        .iter()
        .filter_map(|monitor| {
            let scale = monitor.scale_factor();
            if !(scale.is_finite() && scale > 0.0) {
                return None;
            }
            let position = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            Some(Area {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            })
        })
        .collect()
}

fn place_on_screen(x: f64, y: f64, width: f64, height: f64, areas: &[Area]) -> (f64, f64) {
    let is_visible = |area: &Area| {
        visible_span(x, width, area.x, area.right()) >= MIN_VISIBLE
            && visible_span(y, height, area.y, area.bottom()) >= MIN_VISIBLE
    };
    if areas.iter().any(is_visible) {
        return (x, y);
    }

    // 坐标失效（显示器被拔掉 / 分辨率变化）：夹到离窗口中心最近的显示器上
    let (center_x, center_y) = (x + width / 2.0, y + height / 2.0);
    let target = areas.iter().copied().min_by(|left, right| {
        distance(left.center(), (center_x, center_y))
            .total_cmp(&distance(right.center(), (center_x, center_y)))
    });
    let Some(target) = target else {
        return (x, y);
    };
    // 保证窗口至少有 MIN_VISIBLE 落在目标显示器内（超出可用范围时贴左 / 上边）
    let lowest_x = target.x + MIN_VISIBLE - width;
    let highest_x = target.right() - MIN_VISIBLE;
    let lowest_y = target.y + MIN_VISIBLE - height;
    let highest_y = target.bottom() - MIN_VISIBLE;
    (
        if lowest_x <= highest_x {
            x.clamp(lowest_x, highest_x)
        } else {
            target.x
        },
        if lowest_y <= highest_y {
            y.clamp(lowest_y, highest_y)
        } else {
            target.y
        },
    )
}

fn visible_span(start: f64, length: f64, area_start: f64, area_end: f64) -> f64 {
    (start + length).min(area_end) - start.max(area_start)
}

fn distance(left: (f64, f64), right: (f64, f64)) -> f64 {
    let dx = left.0 - right.0;
    let dy = left.1 - right.1;
    dx * dx + dy * dy
}

/// 关窗 / 退出时落盘：正常态记录完整几何，最大化 / 全屏 / 最小化只更新 maximized 标记。
/// 调用方用 `app.get_window("main")` 取窗口（与创建路径同一套句柄约定）。
pub fn save_current(app: &AppHandle, window: &Window) {
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    if !(scale.is_finite() && scale > 0.0) {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let mut geometry = load(app);
    geometry.maximized = maximized;
    if !maximized && !fullscreen && !minimized {
        let (Ok(size), Ok(position)) = (window.inner_size(), window.outer_position()) else {
            return;
        };
        let size = size.to_logical::<f64>(scale);
        let position = position.to_logical::<f64>(scale);
        geometry = WindowGeometry {
            width: size.width,
            height: size.height,
            x: Some(position.x),
            y: Some(position.y),
            maximized,
        };
    }
    if let Err(error) = save(app, &geometry) {
        log::warn!("[window-geometry] 窗口几何保存失败：{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area(x: f64, y: f64, width: f64, height: f64) -> Area {
        Area {
            x,
            y,
            width,
            height,
        }
    }

    fn geometry(x: Option<f64>, y: Option<f64>, width: f64, height: f64) -> WindowGeometry {
        WindowGeometry {
            width,
            height,
            x,
            y,
            maximized: false,
        }
    }

    #[test]
    fn on_screen_position_is_kept() {
        let monitors = [area(0.0, 0.0, 1920.0, 1080.0)];
        let resolved = resolve_with(geometry(Some(120.0), Some(80.0), 1000.0, 700.0), &monitors);
        assert_eq!(resolved.position(), Some((120.0, 80.0)));
        assert_eq!((resolved.width, resolved.height), (1000.0, 700.0));
    }

    #[test]
    fn second_monitor_position_is_kept() {
        let monitors = [
            area(0.0, 0.0, 1920.0, 1080.0),
            area(1920.0, 0.0, 2560.0, 1440.0),
        ];
        let resolved = resolve_with(
            geometry(Some(2000.0), Some(200.0), 1200.0, 900.0),
            &monitors,
        );
        assert_eq!(resolved.position(), Some((2000.0, 200.0)));
    }

    #[test]
    fn window_on_removed_monitor_is_pulled_back() {
        let monitors = [area(0.0, 0.0, 1920.0, 1080.0)];
        let resolved = resolve_with(
            geometry(Some(4200.0), Some(300.0), 1200.0, 900.0),
            &monitors,
        );
        let (x, y) = resolved.position().expect("位置应被夹回屏幕");
        // 至少 MIN_VISIBLE 落在显示器内，且不整块跑到右边之外
        let visible = (x + resolved.width).min(1920.0) - x.max(0.0);
        assert!(visible >= MIN_VISIBLE, "可见宽度 {visible}");
        assert_eq!(y, 300.0);
    }

    #[test]
    fn oversized_window_is_clamped_to_desktop_bounds() {
        let monitors = [area(0.0, 0.0, 1600.0, 900.0)];
        let resolved = resolve_with(geometry(Some(0.0), Some(0.0), 2600.0, 1500.0), &monitors);
        assert_eq!((resolved.width, resolved.height), (1600.0, 900.0));
    }

    #[test]
    fn window_spanning_two_monitors_keeps_its_size() {
        let monitors = [
            area(0.0, 0.0, 2560.0, 1440.0),
            area(2560.0, 0.0, 1920.0, 1080.0),
        ];
        let resolved = resolve_with(geometry(Some(0.0), Some(0.0), 4000.0, 1200.0), &monitors);
        assert_eq!((resolved.width, resolved.height), (4000.0, 1200.0));
    }

    #[test]
    fn missing_position_stays_centered() {
        let monitors = [area(0.0, 0.0, 1920.0, 1080.0)];
        let resolved = resolve_with(geometry(None, None, 1200.0, 900.0), &monitors);
        assert_eq!(resolved.position(), None);
    }

    #[test]
    fn broken_values_fall_back_to_defaults() {
        let resolved = resolve_with(
            geometry(Some(f64::NAN), Some(10.0), f64::INFINITY, 10.0),
            &[],
        );
        assert_eq!(resolved.position(), None);
        assert_eq!(resolved.width, DEFAULT_WIDTH);
        assert_eq!(resolved.height, MIN_HEIGHT);
    }

    #[test]
    fn maximized_flag_is_preserved() {
        let stored = WindowGeometry {
            maximized: true,
            ..geometry(Some(10.0), Some(10.0), 1200.0, 900.0)
        };
        assert!(resolve_with(stored, &[area(0.0, 0.0, 1920.0, 1080.0)]).maximized);
    }
}
