// workbuddy2api-panel 域：安装包 digest 校验（与 GitHub asset digest 同形 `sha256:<hex>`）。
use sha2::{Digest, Sha256};
use std::io::Read;

pub fn sha256_file_digest(path: &std::path::Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|error| format!("打开文件失败：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("读取文件失败：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

pub fn normalize_digest(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim().to_lowercase();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("sha256:") {
        return Some(trimmed);
    }
    if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(format!("sha256:{trimmed}"));
    }
    Some(trimmed)
}

pub fn assert_file_digest(path: &std::path::Path, expected: &str) -> Result<(), String> {
    let want = normalize_digest(Some(expected)).ok_or("缺少 digest，无法校验安装包")?;
    let got = sha256_file_digest(path)?;
    if got != want {
        return Err(format!("安装包校验失败：期望 {want}，实际 {got}"));
    }
    Ok(())
}
