# pikpak-get NAS 引擎（TS）

PikPak 下载引擎的 NAS 部署形态：与 app 本机内嵌共用同一套 TS 引擎代码
（`tools/pikpak-get/backend/engine/`），这里只多一层 `node:http` 控制面。

完整方案见仓库根 `docs/pikpak-get.md`。app 的「NAS 引擎」模式填
`http://<nas-ip>:8787` + token 远程控制；「本机引擎」模式在 app 内直接调用，无需此部署。

## 打包

在仓库根执行：

```sh
node scripts/build-pikpak-engine.mjs
```

会把引擎打成 `deploy/pikpak-get-nas/service.mjs`（bundle，含 node:http/node:crypto）。

## 部署到 Synology（Container Manager / DSM 7.x）

1. `openssl rand -hex 32` 生成两个随机串，复制 `.env.example` 为 `.env` 填入。
2. 编辑 `docker-compose.yml` 的两个卷路径（`/volume1/docker/pikpakget/config` 与
   `/volume1/media/pikpak`）。
3. Container Manager → 项目 → 新增 → 上传本目录（含 `service.mjs` + `Dockerfile` +
   `docker-compose.yml` + `.env`），启动。

## 备份与换机还原

备份 `config/` 卷（密文）+ `.env`（masterKey + token），换机后同 compose + 同 `.env`
恢复即可还原全部账号（密码、会话、device_id、流量冷却）。masterKey 错误时引擎解密账号
会失败，不会静默覆盖密文。
