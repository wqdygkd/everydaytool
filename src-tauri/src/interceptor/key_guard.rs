// CA 私钥落盘保护。Windows 用 DPAPI（当前用户作用域）加密：数据目录被同步盘 /
// 移动介质带走时，私钥在其它机器或账号下解不开。Unix 依赖文件权限 0600。
// 文件格式：`EDT-DPAPI1\n` magic + CryptProtectData 原始输出；读到旧格式明文时
// 就地加密重写（存量用户无感迁移）。加密失败时不落明文——宁可再生 CA 也不留根钥。
use std::path::Path;

#[cfg(windows)]
const KEY_MAGIC: &[u8] = b"EDT-DPAPI1\n";

/// 写入 CA 私钥（Windows 加密，Unix 明文 + 0600）
pub fn write_ca_key(path: &Path, pem: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let cipher = dpapi::protect(pem.as_bytes())?;
        let mut bytes = KEY_MAGIC.to_vec();
        bytes.extend_from_slice(&cipher);
        std::fs::write(path, bytes).map_err(|error| format!("CA 私钥写入失败：{error}"))?;
    }
    #[cfg(not(windows))]
    {
        std::fs::write(path, pem).map_err(|error| format!("CA 私钥写入失败：{error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
    }
    Ok(())
}

/// 读取 CA 私钥（Windows 下识别 magic 解密，旧格式明文就地加密迁移）
pub fn read_ca_key(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("CA 私钥读取失败：{error}"))?;
    #[cfg(windows)]
    {
        if bytes.starts_with(KEY_MAGIC) {
            let plain = dpapi::unprotect(&bytes[KEY_MAGIC.len()..])?;
            return String::from_utf8(plain)
                .map_err(|_| "CA 私钥解密结果不是有效 UTF-8".to_string());
        }
    }
    let pem = String::from_utf8(bytes).map_err(|_| "CA 私钥文件损坏".to_string())?;
    #[cfg(windows)]
    {
        // 旧版明文：就地加密重写（失败不影响本次加载）
        if let Err(error) = write_ca_key(path, &pem) {
            log::warn!("[interceptor] CA 私钥加密迁移失败：{error}");
        }
    }
    Ok(pem)
}

#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };

    /// DPAPI 当前用户作用域加密（无附加熵、无提示）；输出缓冲区用 LocalFree 释放
    pub(super) fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB {
                cbData: plain.len() as u32,
                pbData: plain.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };
            let description: Vec<u16> = "everydaytool-interceptor-ca\0".encode_utf16().collect();
            let ok = CryptProtectData(
                &input,
                description.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                &mut output,
            );
            if ok == 0 {
                return Err("DPAPI 加密失败".into());
            }
            let data = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData.cast());
            Ok(data)
        }
    }

    pub(super) fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB {
                cbData: cipher.len() as u32,
                pbData: cipher.as_ptr() as *mut u8,
            };
            let mut output = CRYPT_INTEGER_BLOB {
                cbData: 0,
                pbData: std::ptr::null_mut(),
            };
            let ok = CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                &mut output,
            );
            if ok == 0 {
                return Err("DPAPI 解密失败（文件可能来自其它用户或机器）".into());
            }
            let data = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData.cast());
            Ok(data)
        }
    }
}
