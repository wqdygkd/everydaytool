// workbuddy2api-panel 域：/healthz 探活。
//
// 只有桌面壳进程探活：看响应里的 service 字段（或 x-service 头）。
// **503 + 正确 service = running_empty（无可用账号），不是进程挂**——所以不要求 HTTP 200。
use super::HEALTH_SERVICE;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSnapshot {
    pub ok: bool,
    pub status_code: Option<u16>,
    pub service: Option<String>,
    pub healthy: Option<u64>,
    pub total: Option<u64>,
    pub error: Option<String>,
}

impl HealthSnapshot {
    fn failed(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            status_code: None,
            service: None,
            healthy: None,
            total: None,
            error: Some(message.into()),
        }
    }
}

pub fn probe_healthz(port: u16) -> HealthSnapshot {
    let url = format!("http://127.0.0.1:{port}/healthz");
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(2_500))
        .build()
    {
        Ok(client) => client,
        Err(error) => return HealthSnapshot::failed(error.to_string()),
    };

    match client.get(&url).send() {
        Ok(response) => {
            let status = response.status().as_u16();
            let header_service = response
                .headers()
                .get("x-service")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            let body = response.text().unwrap_or_default();
            let parsed = serde_json::from_str::<serde_json::Value>(&body).ok();
            let service = parsed
                .as_ref()
                .and_then(|value| value.get("service"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or(header_service);
            let healthy = parsed
                .as_ref()
                .and_then(|value| value.get("healthy"))
                .and_then(|value| value.as_u64());
            let total = parsed
                .as_ref()
                .and_then(|value| value.get("total"))
                .and_then(|value| value.as_u64());

            let identity_ok = service.as_deref() == Some(HEALTH_SERVICE);
            HealthSnapshot {
                ok: identity_ok,
                status_code: Some(status),
                service: service.clone(),
                healthy,
                total,
                error: if identity_ok {
                    None
                } else {
                    Some(format!(
                        "身份不匹配：service={}",
                        service.unwrap_or_else(|| "null".into())
                    ))
                },
            }
        }
        Err(error) => HealthSnapshot::failed(error.to_string()),
    }
}

pub fn classify_health_status(health: &HealthSnapshot) -> &'static str {
    if !health.ok {
        return "unhealthy";
    }
    match health.status_code {
        Some(503) => "running_empty",
        Some(200) => "running",
        _ => {
            if health.healthy.unwrap_or(0) > 0 {
                "running"
            } else {
                "running_empty"
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(ok: bool, status: Option<u16>, healthy: Option<u64>) -> HealthSnapshot {
        HealthSnapshot {
            ok,
            status_code: status,
            service: None,
            healthy,
            total: None,
            error: None,
        }
    }

    #[test]
    fn classifies_health_states() {
        assert_eq!(classify_health_status(&snapshot(false, None, None)), "unhealthy");
        assert_eq!(classify_health_status(&snapshot(true, Some(503), Some(0))), "running_empty");
        assert_eq!(classify_health_status(&snapshot(true, Some(200), None)), "running");
        assert_eq!(classify_health_status(&snapshot(true, Some(500), Some(2))), "running");
        assert_eq!(classify_health_status(&snapshot(true, Some(500), Some(0))), "running_empty");
    }
}
