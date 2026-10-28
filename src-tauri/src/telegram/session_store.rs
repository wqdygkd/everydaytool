// telegram-cache 域：MTProto 会话落盘保护（等价于 Electron safeStorage 的角色）。
//
// Windows 用 DPAPI（当前用户的加密上下文），Unix 用 0600 权限的文件；
// 两者共用同一套「加密后写文件」的接口，读写失败都只返回 None（会话缺失 → MTProto 不可用，
// 但 HTTP 缓存路径不受影响）。
use std::path::Path;

#[cfg(windows)]
mod protect {
    /// DPAPI：`CryptProtectData` / `CryptUnprotectData`（当前用户作用域）
    pub fn seal(data: &[u8]) -> Option<Vec<u8>> {
        use std::ptr;
        use windows_sys::Win32::Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
        };

        unsafe {
            let mut input = CRYPT_INTEGER_BLOB {
                cbData: data.len() as u32,
                pbData: data.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: ptr::null_mut(),
            };
            let ok = CryptProtectData(
                &mut input,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return None;
            }
            Some(output_to_vec(output))
        }
    }

    pub fn open(data: &[u8]) -> Option<Vec<u8>> {
        use std::ptr;
        use windows_sys::Win32::Security::Cryptography::{
            CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
        };

        unsafe {
            let mut input = CRYPT_INTEGER_BLOB {
                cbData: data.len() as u32,
                pbData: data.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: ptr::null_mut(),
            };
            let ok = CryptUnprotectData(
                &mut input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            );
            if ok == 0 {
                return None;
            }
            Some(output_to_vec(output))
        }
    }

    fn output_to_vec(blob: windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB) -> Vec<u8> {
        unsafe {
            let slice = std::slice::from_raw_parts(blob.pbData, blob.cbData as usize);
            let out = slice.to_vec();
            windows_sys::Win32::Foundation::LocalFree(blob.pbData as *mut core::ffi::c_void);
            out
        }
    }
}

#[cfg(not(windows))]
mod protect {
    use flate2::write::ZlibEncoder;

    /// 非 Windows 没有系统级「按用户」加密：至少做一层 zlib + 标记，避免明文直接可读；
    /// 真正的保护靠 0600 权限（见 `write_sealed`）。
    pub fn seal(data: &[u8]) -> Option<Vec<u8>> {
        use std::io::Write;
        let mut encoder = ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(b"edt-tg-session-v1\n").ok()?;
        encoder.write_all(data).ok()?;
        encoder.finish().ok()
    }

    pub fn open(data: &[u8]) -> Option<Vec<u8>> {
        use std::io::Read;
        let mut decoder = flate2::read::ZlibDecoder::new(data);
        let mut buffer = Vec::new();
        decoder.read_to_end(&mut buffer).ok()?;
        let marker = b"edt-tg-session-v1\n";
        if buffer.len() < marker.len() || &buffer[..marker.len()] != marker {
            return None;
        }
        Some(buffer[marker.len()..].to_vec())
    }
}

pub fn encryption_available() -> bool {
    cfg!(windows)
}

/// 写会话：加密后落盘（Unix 顺带 0600）
pub fn write_sealed(path: &Path, plain: &[u8]) -> Result<(), String> {
    let sealed = protect::seal(plain).ok_or("会话加密失败")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp = path.with_extension("bin.tmp");
    std::fs::write(&temp, &sealed).map_err(|error| format!("写入会话失败：{error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o600));
    }
    if std::fs::rename(&temp, path).is_err() {
        let _ = std::fs::remove_file(path);
        std::fs::rename(&temp, path).map_err(|error| format!("写入会话失败：{error}"))?;
    }
    Ok(())
}

/// 读会话：解密失败 / 文件缺失都返回 None（MTProto 不可用，但 HTTP 路径照常）
pub fn read_sealed(path: &Path) -> Option<Vec<u8>> {
    let sealed = std::fs::read(path).ok()?;
    protect::open(&sealed)
}

pub fn has_session(path: &Path) -> bool {
    path.is_file()
}

pub fn clear(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
