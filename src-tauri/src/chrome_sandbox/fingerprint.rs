// chrome-sandbox 域：随机指纹生成（与 Node 版分布一致）。
use super::store::{
    Fingerprint, FingerprintAudio, FingerprintCanvas, FingerprintNavigator, FingerprintScreen,
    FingerprintTimezone, FingerprintWebgl,
};
use rand::Rng;

const USER_AGENTS: [&str; 3] = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

const WEBGL_VENDORS: [&str; 3] = [
    "Google Inc. (NVIDIA)",
    "Google Inc. (Intel)",
    "Google Inc. (AMD)",
];
const WEBGL_RENDERERS: [&str; 3] = [
    "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)",
];

// (width, height, dpr)
const RESOLUTIONS: [(i64, i64, f64); 4] = [
    (1920, 1080, 1.0),
    (2560, 1440, 1.25),
    (1366, 768, 1.0),
    (1536, 864, 1.25),
];

const NOISE_LEVELS: [&str; 3] = ["low", "medium", "high"];
// (offset, name)
const TIMEZONES: [(i64, &str); 4] = [
    (-480, "Asia/Shanghai"),
    (0, "Europe/London"),
    (-300, "America/New_York"),
    (540, "Asia/Tokyo"),
];

fn platform_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "MacIntel"
    } else if cfg!(target_os = "windows") {
        "Win32"
    } else {
        "Linux x86_64"
    }
}

pub fn generate_random_fingerprint() -> Fingerprint {
    let mut rng = rand::rng();
    let user_agent = USER_AGENTS[rng.random_range(0..USER_AGENTS.len())];
    let webgl_index = rng.random_range(0..WEBGL_VENDORS.len());
    let resolution = RESOLUTIONS[rng.random_range(0..RESOLUTIONS.len())];
    let noise_level = NOISE_LEVELS[rng.random_range(0..NOISE_LEVELS.len())];
    let timezone = TIMEZONES[rng.random_range(0..TIMEZONES.len())];

    Fingerprint {
        id: uuid::Uuid::new_v4().to_string(),
        navigator: FingerprintNavigator {
            user_agent: user_agent.to_string(),
            platform: platform_label().to_string(),
            language: "zh-CN,zh;q=0.9,en;q=0.8".to_string(),
            hardware_concurrency: [4, 6, 8, 12, 16][rng.random_range(0..5)],
            device_memory: [4, 8, 16][rng.random_range(0..3)],
        },
        canvas: FingerprintCanvas {
            noise_level: noise_level.to_string(),
            noise_seed: rng.random_range(1..999_999),
        },
        webgl: FingerprintWebgl {
            vendor: WEBGL_VENDORS[webgl_index].to_string(),
            renderer: WEBGL_RENDERERS[webgl_index].to_string(),
        },
        screen: FingerprintScreen {
            width: resolution.0,
            height: resolution.1,
            color_depth: 24,
            device_pixel_ratio: resolution.2,
        },
        audio: FingerprintAudio {
            noise_enabled: true,
            noise_level: rng.random_range(1..100) as f64 / 1000.0,
        },
        timezone: FingerprintTimezone {
            offset: timezone.0,
            name: timezone.1.to_string(),
        },
        created_at: None,
        updated_at: None,
    }
}
