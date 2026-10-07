import type { Fingerprint } from '../../../../shared/types.ts'
import { randomInt, randomUUID } from 'node:crypto'
import process from 'node:process'

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
]

const WEBGL_PROFILES: Array<{ vendor: string, renderer: string }> = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)' },
]

const RESOLUTIONS: Array<{ width: number, height: number, dpr: number }> = [
  { width: 1920, height: 1080, dpr: 1 },
  { width: 2560, height: 1440, dpr: 1.25 },
  { width: 1366, height: 768, dpr: 1 },
  { width: 1536, height: 864, dpr: 1.25 },
]

const NOISE_LEVELS: Fingerprint['canvas']['noiseLevel'][] = ['low', 'medium', 'high']
const TIMEZONES: Array<{ offset: number, name: string }> = [
  { offset: -480, name: 'Asia/Shanghai' },
  { offset: 0, name: 'Europe/London' },
  { offset: -300, name: 'America/New_York' },
  { offset: 540, name: 'Asia/Tokyo' },
]

function pick<T>(list: T[]): T {
  return list[randomInt(list.length)]
}

function getPlatform(): string {
  if (process.platform === 'darwin') return 'MacIntel'
  if (process.platform === 'win32') return 'Win32'
  return 'Linux x86_64'
}

export function generateRandomFingerprint(): Fingerprint {
  const resolution = pick(RESOLUTIONS)
  const webgl = pick(WEBGL_PROFILES)
  const timezone = pick(TIMEZONES)

  return {
    id: randomUUID(),
    navigator: {
      userAgent: pick(USER_AGENTS),
      platform: getPlatform(),
      language: 'zh-CN,zh;q=0.9,en;q=0.8',
      hardwareConcurrency: pick([4, 6, 8, 12, 16]),
      deviceMemory: pick([4, 8, 16]),
    },
    canvas: {
      noiseLevel: pick(NOISE_LEVELS),
      noiseSeed: randomInt(1, 999999),
    },
    webgl: {
      vendor: webgl.vendor,
      renderer: webgl.renderer,
    },
    screen: {
      width: resolution.width,
      height: resolution.height,
      colorDepth: 24,
      devicePixelRatio: resolution.dpr,
    },
    audio: {
      noiseEnabled: true,
      noiseLevel: randomInt(1, 100) / 1000,
    },
    timezone: {
      offset: timezone.offset,
      name: timezone.name,
    },
  }
}
