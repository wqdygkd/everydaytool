/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { ArchiveError, extractTarGz } from '../backend/services/archive.ts'

interface Entry {
  name: string
  type?: string
  content?: string
  link?: string
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`
}

function header(entry: Entry): Buffer {
  const block = Buffer.alloc(512, 0)
  block.write(entry.name, 0, 100, 'utf8')
  block.write(octal(0o644, 8), 100)
  block.write(octal(0, 8), 108)
  block.write(octal(0, 8), 116)
  block.write(octal(Buffer.byteLength(entry.content ?? ''), 12), 124)
  block.write(octal(0, 12), 136)
  block.fill(0x20, 148, 156)
  block.write(entry.type ?? '0', 156, 1)
  block.write(entry.link ?? '', 157, 100, 'utf8')
  block.write('ustar\0', 257, 6)
  block.write('00', 263, 2)
  let sum = 0
  for (const byte of block) sum += byte
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8)
  return block
}

function makeTar(entries: Entry[]): Buffer {
  const parts: Buffer[] = []
  for (const entry of entries) {
    parts.push(header(entry))
    const content = Buffer.from(entry.content ?? '')
    if (content.length > 0) parts.push(content, Buffer.alloc((512 - (content.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}

test('解压目录条目并跳过符号链接', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edt-archive-'))
  try {
    const archive = makeTar([
      { name: 'skills-main/', type: '5' },
      { name: 'skills-main/link', type: '2', link: '/etc/passwd' },
      { name: 'skills-main/SKILL.md', content: '# skill\n' },
    ])
    const result = await extractTarGz(archive, root)
    assert.equal(result.entries, 3)
    assert.equal(await readFile(join(root, 'skills-main', 'SKILL.md'), 'utf8'), '# skill\n')
    await assert.rejects(stat(join(root, 'skills-main', 'link')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('拒绝路径穿越条目', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edt-archive-'))
  try {
    const archive = makeTar([{ name: '../evil.txt', content: 'nope' }])
    await assert.rejects(
      extractTarGz(archive, root),
      (error: unknown) => error instanceof ArchiveError && error.code === 'archive-unsafe-path',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
