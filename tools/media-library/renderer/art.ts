// 生成式海报 / 剧照占位：真实缩略图加载前（或生成失败时）的稳定占位图。
// 配色与构图都由 id 派生，同一个合集每次看到的占位都一样。取值与预览稿一致。
import { stableHash } from '@shared/media-library'

export interface Palette {
  c1: string
  c2: string
  c3: string
  fg: string
}

export const PALETTES: readonly Palette[] = [
  { c1: '#12302f', c2: '#e8dcc5', c3: '#c78a4a', fg: '#f2ece0' },
  { c1: '#3a1e1b', c2: '#e7c9b3', c3: '#b25a3e', fg: '#f6e9dc' },
  { c1: '#182a3a', c2: '#d7e4ec', c3: '#5e88a8', fg: '#eef6fb' },
  { c1: '#26301f', c2: '#ded8bd', c3: '#7d8a57', fg: '#f3efdc' },
  { c1: '#2f1d2a', c2: '#ecd4d8', c3: '#9a5c70', fg: '#f8e9ed' },
  { c1: '#332a1a', c2: '#eadfc3', c3: '#b58b45', fg: '#f7efdc' },
  { c1: '#101d26', c2: '#cfe3ea', c3: '#3f7a8c', fg: '#eaf6f9' },
  { c1: '#2b1c15', c2: '#e4cbb4', c3: '#9c5a37', fg: '#f5e6d8' },
  { c1: '#efe6d6', c2: '#1b2a2a', c3: '#b45f3c', fg: '#1b2a2a' },
  { c1: '#e7edf1', c2: '#20303b', c3: '#4d7f99', fg: '#20303b' },
]

const POSTER_MOTIFS = ['horizon', 'type', 'bands', 'arc', 'wave', 'contact', 'grid', 'aperture'] as const
const STILL_MOTIFS = ['horizon', 'wave', 'arc', 'bands', 'grid', 'aperture', 'bloom'] as const

export function paletteIndexOf(id: string): number {
  return stableHash(id) % PALETTES.length
}

export function paletteVars(index: number): Record<string, string> {
  const p = PALETTES[((index % PALETTES.length) + PALETTES.length) % PALETTES.length]
  return { '--c1': p.c1, '--c2': p.c2, '--c3': p.c3, '--fg': p.fg }
}

export function posterMotifOf(id: string): string {
  return POSTER_MOTIFS[stableHash(`${id}:m`) % POSTER_MOTIFS.length]
}

export interface StillArt {
  motif: string
  variant: number
  style: Record<string, string>
}

/** 剧照占位：同一合集内用 seed 区分不同位置（拼图格 / 剧集 / 图片序号） */
export function stillArtOf(id: string, seed: number): StillArt {
  const base = paletteIndexOf(id)
  return {
    motif: STILL_MOTIFS[seed % STILL_MOTIFS.length],
    variant: seed % 3,
    style: {
      ...paletteVars(base + (seed % 3)),
      '--x': `${18 + (stableHash(`${id}${seed}`) % 38)}%`,
      '--y': `${12 + (stableHash(`${id}${seed}y`) % 30)}%`,
    },
  }
}
