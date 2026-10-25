#!/usr/bin/env node
// 一次性 MTProto 登录：读取 .env 的 api_id / api_hash，交互输入手机号、验证码（可选二步密码），
// 成功后把 session 字符串打印到终端。脚本不写 .env、不保存会话、不记录凭据。
//
// 用法：pnpm telegram:session
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')

function parseEnvFile(filePath) {
  const out = {}
  try {
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const body = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed
      const eq = body.indexOf('=')
      if (eq <= 0) continue
      const key = body.slice(0, eq).trim()
      if (!/^[\w.-]+$/.test(key)) continue
      let value = body.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  } catch {
    // 文件不存在时按空处理
  }
  return out
}

const env = { ...parseEnvFile(path.join(root, '.env')) }
for (const key of ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION']) {
  if (process.env[key]) env[key] = process.env[key]
}

const apiId = Number(env.TELEGRAM_API_ID)
const apiHash = env.TELEGRAM_API_HASH
if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash) {
  console.error('缺少 TELEGRAM_API_ID / TELEGRAM_API_HASH：请先在项目根目录的 .env 中配置。')
  process.exit(1)
}

const { TelegramClient, sessions, WebSocketTransport } = require('teleproto')

const { StringSession } = sessions

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = question => rl.question(question)
const client = new TelegramClient(new StringSession(env.TELEGRAM_SESSION || ''), apiId, apiHash, {
  connectionRetries: 3,
  transport: new WebSocketTransport(),
  deviceModel: 'everydaytool',
  systemVersion: process.platform,
  appVersion: '1.7.0',
  langCode: 'zh',
})

try {
  await client.start({
    phoneNumber: () => ask('手机号（含国家码，如 +8613800000000）: '),
    phoneCode: () => ask('验证码: '),
    password: () => ask('二步验证密码（未开启直接回车）: '),
    onError: (error) => {
      console.error('\n登录失败：', error?.message ?? error)
      return error
    },
  })

  const session = client.session.save()
  console.log('\n===== 把下面整行填进 .env 的 TELEGRAM_SESSION =====')
  console.log(session)
  console.log('=================================================\n')
  console.log('该字符串等价于账号登录态，泄露即可被他人使用：不要提交、不要截图外发。')
} catch (error) {
  console.error('登录流程异常：', error?.message ?? error)
  process.exitCode = 1
} finally {
  try {
    await client.disconnect()
  } catch {
    // 忽略
  }
  rl.close()
  // 避免 teleproto 的后台重连计时器让进程挂住
  process.exit(process.exitCode ?? 0)
}
