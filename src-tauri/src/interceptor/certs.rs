// interceptor 域：根 CA 与叶证书生成 / 管理（rcgen，纯 Rust，对齐 Node 版 cert-service.ts）。
// 契约：根 CA 10 年、叶证书 397 天、SHA1 指纹查/删。密钥算法为 ECDSA P-256
// （浏览器均支持；Node 版是 RSA 2048，算法不构成兼容性约束）。
// 从磁盘加载的 CA 通过 from_ca_cert_pem 重建签发者：同 subject + 同密钥，
// 叶子证书的签发者 DN / AKI 都指向真实受信 CA，链路不变。
use crate::interceptor::paths;
use base64::Engine;
use rcgen::{
    CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair,
    KeyUsagePurpose, SanType,
};
use sha1::{Digest, Sha1};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

const ROOT_CA_COMMON_NAME: &str = "edt Interceptor CA";
const ROOT_CA_ORGANIZATION: &str = "everydaytool";
const ROOT_CA_VALIDITY_DAYS: i64 = 3650;
/// 叶证书有效期：平台硬限 398 天内
const LEAF_VALIDITY_DAYS: i64 = 397;
/// 剩余有效期不足该天数时视为需要重签
const RENEW_THRESHOLD_DAYS: i64 = 30;

pub struct RootCa {
    /// 叶证书签发者（内存生成的真实 CA；磁盘加载的 CA 重建的同主体占位对象）
    issuer: rcgen::Certificate,
    ca_key: KeyPair,
    pub cert_pem: String,
    pub key_pem: String,
    pub fingerprint: String,
    /// 过期时间（unix 秒）；磁盘加载的 CA 不参与自动重签判定
    pub expires_at: i64,
}

#[derive(Clone)]
pub struct LeafCertificate {
    pub key_pem: String,
    pub cert_pem: String,
    /// DER 形态（rustls 服务端配置用）
    pub cert_der: Vec<u8>,
    pub key_der: Vec<u8>,
}

fn now() -> time::OffsetDateTime {
    time::OffsetDateTime::now_utc()
}

fn sha1_fingerprint_hex(cert_pem: &str) -> String {
    // PEM → DER：剥掉头尾行后 base64 解码
    let body: String = cert_pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    let der = base64::engine::general_purpose::STANDARD
        .decode(body.trim())
        .unwrap_or_default();
    let digest = Sha1::digest(&der);
    digest.iter().map(|byte| format!("{byte:02X}")).collect()
}

fn is_expiring_soon(expires_at: i64) -> bool {
    let threshold = (now() + time::Duration::days(RENEW_THRESHOLD_DAYS)).unix_timestamp();
    expires_at != 0 && expires_at < threshold
}

fn validity_range(days: i64) -> (time::OffsetDateTime, time::OffsetDateTime) {
    (
        now() - time::Duration::days(1),
        now() + time::Duration::days(days),
    )
}

fn generate_root_ca() -> Result<RootCa, String> {
    let key = KeyPair::generate().map_err(|e| format!("CA 密钥生成失败：{e}"))?;
    let mut params = CertificateParams::default();
    params.distinguished_name = {
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, ROOT_CA_COMMON_NAME);
        dn.push(DnType::OrganizationName, ROOT_CA_ORGANIZATION);
        dn
    };
    params.is_ca = IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::CrlSign,
    ];
    let (not_before, not_after) = validity_range(ROOT_CA_VALIDITY_DAYS);
    params.not_before = not_before;
    params.not_after = not_after;

    let issuer = params
        .self_signed(&key)
        .map_err(|e| format!("CA 自签失败：{e}"))?;
    let cert_pem = issuer.pem();

    Ok(RootCa {
        fingerprint: sha1_fingerprint_hex(&cert_pem),
        issuer,
        cert_pem,
        key_pem: key.serialize_pem(),
        ca_key: key,
        expires_at: not_after.unix_timestamp(),
    })
}

fn is_ip_address(host: &str) -> bool {
    host.parse::<std::net::IpAddr>().is_ok()
}

fn generate_leaf_certificate(root: &RootCa, host: &str) -> Result<LeafCertificate, String> {
    let key = KeyPair::generate().map_err(|e| format!("叶证书密钥生成失败：{e}"))?;
    let mut params = CertificateParams::default();
    params.distinguished_name = {
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, host);
        dn
    };
    params.is_ca = IsCa::ExplicitNoCa;
    params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
    ];
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    params.subject_alt_names = vec![if is_ip_address(host) {
        SanType::IpAddress(host.parse().map_err(|_| format!("非法 IP：{host}"))?)
    } else {
        SanType::DnsName(host.try_into().map_err(|_| format!("非法主机名：{host}"))?)
    }];
    let (not_before, not_after) = validity_range(LEAF_VALIDITY_DAYS);
    params.not_before = not_before;
    params.not_after = not_after;

    let cert = params
        .signed_by(&key, &root.issuer, &root.ca_key)
        .map_err(|e| format!("叶证书签发失败：{e}"))?;
    Ok(LeafCertificate {
        cert_der: cert.der().to_vec(),
        key_der: key.serialize_der(),
        cert_pem: cert.pem(),
        key_pem: key.serialize_pem(),
    })
}

fn load_root_ca_from_disk() -> Option<RootCa> {
    let (key_path, cert_path) = (paths::ca_key_path(), paths::ca_cert_path());
    if !key_path.exists() || !cert_path.exists() {
        return None;
    }
    let key_pem = std::fs::read_to_string(&key_path).ok()?;
    let cert_pem = std::fs::read_to_string(&cert_path).ok()?;
    let ca_key = KeyPair::from_pem(&key_pem).ok()?;
    let ca_params = CertificateParams::from_ca_cert_pem(&cert_pem).ok()?;
    // 重建签发者：同 subject + 同密钥，叶证书仍正确链到磁盘上的受信 CA
    let issuer = ca_params.clone().self_signed(&ca_key).ok()?;
    Some(RootCa {
        fingerprint: sha1_fingerprint_hex(&cert_pem),
        issuer,
        cert_pem,
        key_pem,
        ca_key,
        expires_at: 0,
    })
}

fn persist_root_ca(info: &RootCa) {
    let dir = paths::certs_directory();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(paths::ca_key_path(), &info.key_pem);
    let _ = std::fs::write(paths::ca_cert_path(), &info.cert_pem);
    // 私钥收紧权限；Windows 上为 no-op，失败不影响主流程
    #[cfg(unix)]
    {
        let _ = std::fs::set_permissions(std::path::Path::new(&paths::ca_key_path()), {
            use std::os::unix::fs::PermissionsExt;
            std::fs::Permissions::from_mode(0o600)
        });
    }
}

static ROOT_CA: LazyLock<Mutex<Option<Arc<RootCa>>>> = LazyLock::new(|| Mutex::new(None));

/// 确保根 CA 存在（缺失或临期自动重新生成；重新生成后旧指纹失效，需重新安装信任）
pub fn ensure_root_ca() -> Result<Arc<RootCa>, String> {
    let mut guard = ROOT_CA.lock().unwrap();
    if let Some(existing) = guard.as_ref() {
        if !is_expiring_soon(existing.expires_at) {
            return Ok(existing.clone());
        }
    }
    let loaded = load_root_ca_from_disk().filter(|loaded| !is_expiring_soon(loaded.expires_at));
    let root = match loaded {
        Some(loaded) => Arc::new(loaded),
        None => {
            let generated = Arc::new(generate_root_ca()?);
            persist_root_ca(&generated);
            generated
        }
    };
    *guard = Some(root.clone());
    Ok(root)
}

/// 根证书是否已生成（不触发生成）
pub fn is_root_ca_generated() -> bool {
    paths::ca_key_path().exists() && paths::ca_cert_path().exists()
}

/// 读取已生成的根证书信息（不生成）；未生成返回 None
pub fn read_root_ca() -> Option<Arc<RootCa>> {
    if let Some(existing) = ROOT_CA.lock().unwrap().as_ref() {
        return Some(existing.clone());
    }
    let loaded = load_root_ca_from_disk()?;
    let loaded = Arc::new(loaded);
    *ROOT_CA.lock().unwrap() = Some(loaded.clone());
    Some(loaded)
}

type LeafCacheMap = std::collections::HashMap<String, (LeafCertificate, std::time::Instant)>;

static LEAF_CACHE: LazyLock<Mutex<LeafCacheMap>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// 按域名取叶证书（内存缓存 6 小时；平台 398 天上限内，重签成本低）
pub fn get_leaf_certificate(root: &RootCa, host: &str) -> Result<LeafCertificate, String> {
    let normalized = host
        .to_lowercase()
        .trim_matches(|c| c == '[' || c == ']')
        .to_string();
    if let Some((cached, at)) = LEAF_CACHE.lock().unwrap().get(&normalized) {
        if at.elapsed() < Duration::from_secs(6 * 60 * 60) {
            return Ok(cached.clone());
        }
    }
    let leaf = generate_leaf_certificate(root, &normalized)?;
    LEAF_CACHE
        .lock()
        .unwrap()
        .insert(normalized, (leaf.clone(), std::time::Instant::now()));
    Ok(leaf)
}

/// 数据目录切换后丢弃全部证书缓存（文件按新目录重新加载）
pub fn reset_cert_caches() {
    *ROOT_CA.lock().unwrap() = None;
    LEAF_CACHE.lock().unwrap().clear();
}
#[cfg(test)]
mod cert_tests {
    use super::*;

    #[test]
    fn generates_root_ca_and_leaf() {
        let root = ensure_root_ca().expect("根 CA 生成失败");
        assert!(root.cert_pem.contains("BEGIN CERTIFICATE"));
        assert_eq!(root.fingerprint.len(), 40);
        let leaf = get_leaf_certificate(&root, "127.0.0.1").expect("叶证书签发失败");
        assert!(leaf.cert_pem.contains("BEGIN CERTIFICATE"));
        assert!(leaf.key_pem.contains("PRIVATE KEY"));
        // rustls 服务端配置可用（schannel 不支持 ECDSA 私钥，故 MITM 走 rustls）
        let chain = vec![rustls::pki_types::CertificateDer::from(
            leaf.cert_der.clone(),
        )];
        let key = rustls::pki_types::PrivateKeyDer::try_from(leaf.key_der.clone())
            .expect("私钥 DER 解析失败");
        rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(chain, key)
            .expect("rustls 服务端配置失败");
    }
}
