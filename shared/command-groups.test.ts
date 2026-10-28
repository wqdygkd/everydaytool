import { describe, expect, it } from 'vitest'
import { COMMAND_GROUPS } from './command-groups/index'

// 渲染层与 Rust 的契约不变量：这里坏掉的后果是跨端 invoke 错位，
// 在最便宜的纯函数层拦住，不用等到桌面端手点才发现。
describe('command-groups 契约不变量', () => {
  it('九个业务域齐全且 domain 唯一', () => {
    expect(COMMAND_GROUPS).toHaveLength(9)
    const domains = COMMAND_GROUPS.map(group => group.domain)
    expect(new Set(domains).size).toBe(domains.length)
  })

  it('每组声明 Rust 侧注册的 Tauri command 名（<snake_domain>_command）', () => {
    for (const group of COMMAND_GROUPS) {
      expect(group.command, group.domain).toMatch(/^\w+_command$/)
    }
  })

  it('每组命令映射非空，通道串全局唯一', () => {
    const seen = new Set<string>()
    for (const group of COMMAND_GROUPS) {
      const channels = Object.values(group.commands)
      expect(channels.length, group.domain).toBeGreaterThan(0)
      for (const channel of channels) {
        expect(seen.has(channel), `${group.domain} 通道重复：${channel}`).toBe(false)
        seen.add(channel)
      }
    }
  })

  it('通道串带命名空间前缀（<ns>:…），且不含空白', () => {
    for (const group of COMMAND_GROUPS) {
      for (const [key, channel] of Object.entries(group.commands)) {
        expect(channel, `${group.domain}/${key}`).toMatch(/^[a-z][\w-]*:/)
        expect(channel, `${group.domain}/${key}`).not.toMatch(/\s/)
      }
    }
  })
})
