// telegram-cache 域：可持久化会话（替代 Electron safeStorage + teleproto session）。
//
// grammers 的 `MemorySession` 不暴露内部状态，而 `SessionData` 也没有 serde（0.11）。
// 因此这里自己实现 `grammers_session::Session`：数据挂在 `Arc<Mutex<SessionData>>` 上，
// 每次写入顺带把「home_dc + dc_options（含授权密钥）+ updates_state」加密落盘。
// 语义与 `MemorySession` 一致，只是多了持久化。
use grammers_session::types::{DcOption, PeerId, PeerInfo, UpdateState, UpdatesState};
use grammers_session::{BoxFuture, Session, SessionData};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug)]
pub struct SessionError(String);

impl std::fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.0)
    }
}

impl std::error::Error for SessionError {}

/// 落盘表示：只保留重连必需的三块（peer 缓存会自然重建）
#[derive(Serialize, Deserialize)]
struct Persisted {
    home_dc: i32,
    dc_options: HashMap<i32, DcOption>,
    updates_state: UpdatesState,
}

pub struct FileSession {
    data: Arc<Mutex<SessionData>>,
    path: PathBuf,
}

impl FileSession {
    /// 从加密文件恢复；文件缺失 / 解密失败返回 Err（调用方据此提示「先导入会话」）
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let raw = super::session_store::read_sealed(&path)
            .ok_or("会话文件缺失或无法解密（请先导入已登录会话）")?;
        let persisted: Persisted = serde_json::from_slice(&raw)
            .map_err(|error| format!("会话格式非法：{error}"))?;
        let data = SessionData {
            home_dc: persisted.home_dc,
            dc_options: persisted.dc_options,
            peer_infos: HashMap::new(),
            updates_state: persisted.updates_state,
        };
        Ok(Self {
            data: Arc::new(Mutex::new(data)),
            path,
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, SessionData>, String> {
        self.data
            .lock()
            .map_err(|_| "会话状态锁定失败".to_string())
    }

    /// 把当前状态加密落盘
    pub fn persist(&self) -> Result<(), String> {
        let persisted = {
            let guard = self.lock()?;
            Persisted {
                home_dc: guard.home_dc,
                dc_options: guard.dc_options.clone(),
                updates_state: guard.updates_state.clone(),
            }
        };
        let body = serde_json::to_vec(&persisted)
            .map_err(|error| format!("序列化会话失败：{error}"))?;
        super::session_store::write_sealed(&self.path, &body)
    }

}

impl Session for FileSession {
    type Error = SessionError;

    fn home_dc_id(&self) -> Result<i32, Self::Error> {
        Ok(self.lock().map_err(SessionError)?.home_dc)
    }

    fn set_home_dc_id(&self, dc_id: i32) -> BoxFuture<'_, Result<(), Self::Error>> {
        Box::pin(async move {
            self.lock().map_err(SessionError)?.home_dc = dc_id;
            let _ = self.persist();
            Ok(())
        })
    }

    fn dc_option(&self, dc_id: i32) -> Result<Option<DcOption>, Self::Error> {
        Ok(self
            .lock()
            .map_err(SessionError)?
            .dc_options
            .get(&dc_id)
            .cloned())
    }

    fn set_dc_option(&self, dc_option: &DcOption) -> BoxFuture<'_, Result<(), Self::Error>> {
        let dc_option = dc_option.clone();
        Box::pin(async move {
            self.lock()
                .map_err(SessionError)?
                .dc_options
                .insert(dc_option.id, dc_option);
            let _ = self.persist();
            Ok(())
        })
    }

    fn peer(&self, peer: PeerId) -> BoxFuture<'_, Result<Option<PeerInfo>, Self::Error>> {
        Box::pin(async move {
            Ok(self
                .lock()
                .map_err(SessionError)?
                .peer_infos
                .get(&peer)
                .cloned())
        })
    }

    fn cache_peer(&self, peer: PeerInfo) -> BoxFuture<'_, Result<(), Self::Error>> {
        Box::pin(async move {
            self.lock()
                .map_err(SessionError)?
                .peer_infos
                .insert(peer.id(), peer);
            Ok(())
        })
    }

    fn updates_state(&self) -> BoxFuture<'_, Result<UpdatesState, Self::Error>> {
        Box::pin(async move { Ok(self.lock().map_err(SessionError)?.updates_state.clone()) })
    }

    fn set_update_state(&self, update: UpdateState) -> BoxFuture<'_, Result<(), Self::Error>> {
        Box::pin(async move {
            let mut guard = self.lock().map_err(SessionError)?;
            match update {
                UpdateState::All(state) => guard.updates_state = state,
                UpdateState::Primary { pts, date, seq } => {
                    guard.updates_state.pts = pts;
                    guard.updates_state.date = date;
                    guard.updates_state.seq = seq;
                }
                UpdateState::Secondary { qts } => guard.updates_state.qts = qts,
                UpdateState::Channel { id, pts } => {
                    guard.updates_state.channels.retain(|channel| channel.id != id);
                    guard
                        .updates_state
                        .channels
                        .push(grammers_session::types::ChannelState { id, pts });
                }
            }
            Ok(())
        })
    }
}
