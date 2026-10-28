// 数据目录整体迁移（仅用户主动切换目录时使用，不是首次启动迁移）。
//
// 策略：先完整复制到目标目录，全部成功后才删除源目录；任何一步失败都回滚目标中已复制的
// 条目，源目录保持原样，避免出现「一半在旧目录、一半在新目录」的缓存分裂。
//
// 调用时机：`run()` 的最开头（早于 webview 数据目录解析、日志目录解析、窗口创建），
// 此时本进程还没有任何文件句柄落在数据目录里，可以安全复制整个目录。
use std::fs;
use std::path::{Path, PathBuf};

/// 迁移结果：成功时带被搬运的顶级条目名（用于日志）。
pub struct MigrationOutcome {
    pub moved: Vec<String>,
}

fn is_empty_dir(dir: &Path) -> bool {
    match fs::read_dir(dir) {
        Ok(mut entries) => entries.next().is_none(),
        Err(_) => false,
    }
}

/// 递归复制（目录 / 文件 / 符号链接按文件内容复制）：目标已存在即报错，
/// 绝不覆盖用户数据——迁移前已要求目标目录为空，出现同名项说明中途被写过。
fn copy_tree(source: &Path, target: &Path) -> std::io::Result<()> {
    if target.exists() {
        return Err(std::io::Error::other(format!(
            "目标目录已存在同名项：{}",
            target.display()
        )));
    }
    let meta = fs::symlink_metadata(source)?;
    if meta.is_dir() {
        fs::create_dir_all(target)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_tree(&entry.path(), &target.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, target)?;
        Ok(())
    }
}

/// 路径 A 是否严格位于 B 之内（用于禁止新旧目录互相嵌套）。
fn is_strictly_within(inner: &Path, outer: &Path) -> bool {
    let a = fs::canonicalize(inner).unwrap_or_else(|_| inner.to_path_buf());
    let b = fs::canonicalize(outer).unwrap_or_else(|_| outer.to_path_buf());
    a != b && a.starts_with(&b)
}

fn same_path(a: &Path, b: &Path) -> bool {
    let a = fs::canonicalize(a).unwrap_or_else(|_| a.to_path_buf());
    let b = fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    a == b
}

/// 把 `from` 下的全部条目搬到 `to`。
/// - `to` 必须为空或不存在；遇到同名条目直接失败（不覆盖用户数据）。
/// - 复制成功后再删源；源目录删空后一并移除。
pub fn migrate_data_directory(from_path: &Path, to_path: &Path) -> Result<MigrationOutcome, String> {
    if same_path(from_path, to_path) {
        return Ok(MigrationOutcome { moved: Vec::new() });
    }
    if is_strictly_within(from_path, to_path) || is_strictly_within(to_path, from_path) {
        return Err("源目录与目标目录不能互相嵌套".into());
    }
    if !from_path.exists() {
        fs::create_dir_all(to_path).map_err(|error| error.to_string())?;
        return Ok(MigrationOutcome { moved: Vec::new() });
    }
    if to_path.exists() && !is_empty_dir(to_path) {
        return Err("目标目录非空，请选择空目录".into());
    }
    fs::create_dir_all(to_path).map_err(|error| error.to_string())?;

    let entries: Vec<PathBuf> = fs::read_dir(from_path)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();

    let mut copied: Vec<PathBuf> = Vec::new();
    for source in &entries {
        let Some(name) = source.file_name() else {
            continue;
        };
        let target = to_path.join(name);
        match copy_tree(source, &target) {
            Ok(()) => copied.push(target),
            Err(error) => {
                // 回滚本次已复制的条目（含写到一半的当前条目），源目录保持不动
                let _ = fs::remove_dir_all(&target);
                let _ = fs::remove_file(&target);
                for done in &copied {
                    let _ = fs::remove_dir_all(done);
                    let _ = fs::remove_file(done);
                }
                log::warn!(
                    "[data] 数据目录迁移失败：{} -> {}：{error}",
                    from_path.display(),
                    to_path.display()
                );
                return Err(error.to_string());
            }
        }
    }

    let mut moved = Vec::with_capacity(entries.len());
    for source in &entries {
        if let Some(name) = source.file_name() {
            moved.push(name.to_string_lossy().to_string());
        }
        if let Err(error) = fs::remove_dir_all(source).or_else(|_| fs::remove_file(source)) {
            log::warn!(
                "[data] 删除已迁移的源条目失败：{}：{error}",
                source.display()
            );
        }
    }
    if is_empty_dir(from_path) {
        let _ = fs::remove_dir(from_path);
    }

    log::info!(
        "[data] 数据目录已迁移：{} -> {}（{} 项）",
        from_path.display(),
        to_path.display(),
        moved.len()
    );
    Ok(MigrationOutcome { moved })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "edt-migrate-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn migrates_entries_and_removes_source() {
        let root = temp_dir("ok");
        let from = root.join("old");
        let to = root.join("new");
        fs::create_dir_all(from.join("telegram-cache")).unwrap();
        fs::write(from.join("telegram-cache").join("registry.json"), "{}").unwrap();
        fs::write(from.join("app.json"), "1").unwrap();

        let outcome = migrate_data_directory(&from, &to).unwrap();
        assert_eq!(outcome.moved.len(), 2);
        assert!(to.join("telegram-cache").join("registry.json").is_file());
        assert!(to.join("app.json").is_file());
        assert!(!from.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_non_empty_target() {
        let root = temp_dir("nonempty");
        let from = root.join("old");
        let to = root.join("new");
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("a.json"), "1").unwrap();
        fs::create_dir_all(&to).unwrap();
        fs::write(to.join("keep.json"), "1").unwrap();

        assert!(migrate_data_directory(&from, &to).is_err());
        // 源目录保持原样
        assert!(from.join("a.json").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_nested_paths() {
        let root = temp_dir("nested");
        let from = root.join("old");
        fs::create_dir_all(from.join("inner")).unwrap();
        let to = from.join("inner").join("deeper");
        assert!(migrate_data_directory(&from, &to).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
