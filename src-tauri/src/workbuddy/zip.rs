// workbuddy2api-panel 域：跨平台解压 ZIP。
// 先试系统工具（unzip / PowerShell Expand-Archive，能正确处理 ZIP64 与各种扩展字段），
// 失败再走内置极简实现（中央目录 + store/deflate，够用上游发行包）。
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

fn extract_with_system(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let script = format!(
            "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            zip_path.display().to_string().replace('\'', "''"),
            dest_dir.display().to_string().replace('\'', "''")
        );
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    #[cfg(not(windows))]
    {
        let output = std::process::Command::new("unzip")
            .arg("-o")
            .arg(zip_path)
            .arg("-d")
            .arg(dest_dir)
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            return Ok(());
        }
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn read_u16(data: &[u8], offset: usize) -> Option<u16> {
    data.get(offset..offset + 2)
        .map(|slice| u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    data.get(offset..offset + 4)
        .map(|slice| u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// 拒绝绝对路径与 `..`：ZIP 里的名字不可信，解压绝不能跑到 dest 之外。
fn safe_join(dest_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(name);
    let mut out = dest_dir.to_path_buf();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return Err(format!("ZIP 含非法路径：{name}")),
        }
    }
    Ok(out)
}

fn write_entry(
    data: &[u8],
    method: u16,
    comp_start: usize,
    comp_size: usize,
    dest: &Path,
) -> Result<(), String> {
    let raw = data
        .get(comp_start..comp_start + comp_size)
        .ok_or("ZIP 文件截断")?;
    let content: Vec<u8> = match method {
        0 => raw.to_vec(),
        8 => {
            let mut decoder = flate2::read::DeflateDecoder::new(raw);
            let mut buffer = Vec::with_capacity(comp_size * 4);
            decoder
                .read_to_end(&mut buffer)
                .map_err(|error| format!("解压条目失败：{error}"))?;
            buffer
        }
        other => return Err(format!("不支持的 ZIP 压缩方式：{other}")),
    };
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = std::fs::File::create(dest).map_err(|error| error.to_string())?;
    file.write_all(&content).map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn extract_internal(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let data = std::fs::read(zip_path).map_err(|error| format!("读取 ZIP 失败：{error}"))?;

    // 1) 找中央目录结束记录（EOCD，0x06054b50），从尾部 64KB 内倒着找
    let mut eocd: Option<usize> = None;
    let tail_start = data.len().saturating_sub(66_000);
    let mut index = data.len().saturating_sub(4);
    while index > tail_start {
        if read_u32(&data, index) == Some(0x0605_4B50) {
            eocd = Some(index);
            break;
        }
        index -= 1;
    }
    let Some(eocd) = eocd else {
        return Err("不是有效的 ZIP（缺少中央目录）".into());
    };
    let entry_count = read_u16(&data, eocd + 10).ok_or("ZIP 中央目录损坏")?;
    let cd_offset = read_u32(&data, eocd + 16).ok_or("ZIP 中央目录损坏")? as usize;

    let mut cursor = cd_offset;
    let mut extracted = 0usize;
    for _ in 0..entry_count {
        if read_u32(&data, cursor) != Some(0x0201_4B50) {
            break;
        }
        let method = read_u16(&data, cursor + 10).ok_or("ZIP 中央目录损坏")?;
        let comp_size = read_u32(&data, cursor + 20).ok_or("ZIP 中央目录损坏")? as usize;
        let name_len = read_u16(&data, cursor + 28).ok_or("ZIP 中央目录损坏")? as usize;
        let extra_len = read_u16(&data, cursor + 30).ok_or("ZIP 中央目录损坏")? as usize;
        let comment_len = read_u16(&data, cursor + 32).ok_or("ZIP 中央目录损坏")? as usize;
        let local_offset = read_u32(&data, cursor + 42).ok_or("ZIP 中央目录损坏")? as usize;
        let name_start = cursor + 46;
        let name = String::from_utf8_lossy(
            data.get(name_start..name_start + name_len)
                .ok_or("ZIP 中央目录损坏")?,
        )
        .to_string();
        cursor = name_start + name_len + extra_len + comment_len;

        if name.ends_with('/') {
            let dir = safe_join(dest_dir, &name)?;
            std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
            continue;
        }
        if read_u32(&data, local_offset) != Some(0x0403_4B50) {
            return Err(format!("ZIP 条目头损坏：{name}"));
        }
        let local_name_len = read_u16(&data, local_offset + 26).ok_or("ZIP 条目头损坏")? as usize;
        let local_extra_len = read_u16(&data, local_offset + 28).ok_or("ZIP 条目头损坏")? as usize;
        let comp_start = local_offset + 30 + local_name_len + local_extra_len;
        let dest = safe_join(dest_dir, &name)?;
        write_entry(&data, method, comp_start, comp_size, &dest)?;
        extracted += 1;
    }

    if extracted == 0 && entry_count > 0 {
        return Err("ZIP 解压失败：没有可解出的文件".into());
    }
    Ok(())
}

pub fn extract_archive(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(dest_dir);
    std::fs::create_dir_all(dest_dir).map_err(|error| format!("创建解压目录失败：{error}"))?;
    if extract_with_system(zip_path, dest_dir).is_ok() {
        return Ok(());
    }
    log::warn!("[wb2api] 系统解压不可用，改用内置 ZIP 解析");
    extract_internal(zip_path, dest_dir)
}

/// 在解压目录内递归找 `wb2api` / `wb2api.exe`（发行包可能多套一层目录）。
pub fn find_binary_in_dir(root: &Path, binary_name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_binary_in_dir(&path, binary_name) {
                return Some(found);
            }
        } else if path.file_name().and_then(|name| name.to_str()) == Some(binary_name) {
            return Some(path);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 造一个最小 ZIP：一个 store 文件 + 一个 deflate 文件（含嵌套目录）
    fn build_zip(path: &Path) {
        let store_name = "wb2api";
        let store_data = b"binary-bytes".to_vec();
        let deflate_name = "nested/config.example.json";
        let deflate_raw = br#"{"listen":":7863"}"#.to_vec();
        let mut encoder =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&deflate_raw).unwrap();
        let deflate_data = encoder.finish().unwrap();

        let mut body: Vec<u8> = Vec::new();
        let mut central: Vec<u8> = Vec::new();
        let mut push_entry = |name: &str, data: &[u8], method: u16, body: &mut Vec<u8>, central: &mut Vec<u8>| {
            let offset = body.len() as u32;
            let crc = crc32(data);
            body.extend_from_slice(&0x0403_4B50u32.to_le_bytes());
            body.extend_from_slice(&20u16.to_le_bytes());
            body.extend_from_slice(&0u16.to_le_bytes());
            body.extend_from_slice(&method.to_le_bytes());
            body.extend_from_slice(&0u16.to_le_bytes());
            body.extend_from_slice(&0u16.to_le_bytes());
            body.extend_from_slice(&crc.to_le_bytes());
            body.extend_from_slice(&(data.len() as u32).to_le_bytes());
            body.extend_from_slice(&(data.len() as u32).to_le_bytes());
            body.extend_from_slice(&(name.len() as u16).to_le_bytes());
            body.extend_from_slice(&0u16.to_le_bytes());
            body.extend_from_slice(name.as_bytes());
            body.extend_from_slice(data);

            central.extend_from_slice(&0x0201_4B50u32.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&20u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&method.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&crc.to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(name.len() as u16).to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u32.to_le_bytes());
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(name.as_bytes());
        };

        push_entry(store_name, &store_data, 0, &mut body, &mut central);
        push_entry(deflate_name, &deflate_data, 8, &mut body, &mut central);

        let cd_offset = body.len() as u32;
        let cd_size = central.len() as u32;
        let mut out = body;
        out.extend_from_slice(&central);
        out.extend_from_slice(&0x0605_4B50u32.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&cd_size.to_le_bytes());
        out.extend_from_slice(&cd_offset.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        std::fs::write(path, out).unwrap();
    }

    /// 极简 CRC32（仅测试用，ZIP 记录字段不参与校验）
    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for byte in data {
            crc ^= *byte as u32;
            for _ in 0..8 {
                if crc & 1 == 1 {
                    crc = (crc >> 1) ^ 0xEDB8_8320;
                } else {
                    crc >>= 1;
                }
            }
        }
        !crc
    }

    #[test]
    fn internal_reader_extracts_entries() {
        let root = std::env::temp_dir().join(format!("edt-zip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let zip_path = root.join("asset.zip");
        build_zip(&zip_path);
        let dest = root.join("out");

        extract_internal(&zip_path, &dest).unwrap();
        assert_eq!(std::fs::read(dest.join("wb2api")).unwrap(), b"binary-bytes");
        assert_eq!(
            std::fs::read(dest.join("nested").join("config.example.json")).unwrap(),
            br#"{"listen":":7863"}"#
        );
        assert!(find_binary_in_dir(&dest, "wb2api").is_some());
        let _ = std::fs::remove_dir_all(&root);
    }
}
