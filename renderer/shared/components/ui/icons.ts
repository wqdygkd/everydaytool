/** 线性图标库：stroke 风格，viewBox 与各工具原内联 SVG 保持一致，保证迁移后视觉不变 */

interface IconDef {
  /** viewBox 边长（正方形） */
  vb: number
  paths?: string[]
  /** [cx, cy, r, filled?] */
  circles?: Array<[number, number, number, boolean?]>
  /** [x, y, width, height, rx?] */
  rects?: Array<[number, number, number, number, number?]>
  /** 默认线宽 */
  sw?: number
}

export const icons = {
  search: { vb: 20, paths: ['M13.2 13.2L17 17'], circles: [[9, 9, 5.5]], sw: 1.6 },
  plus: { vb: 20, paths: ['M10 4v12M4 10h12'], sw: 1.8 },
  close: { vb: 20, paths: ['M5 5l10 10M15 5L5 15'], sw: 1.6 },
  pin: { vb: 20, paths: ['M7.5 3.5h5', 'M8.7 3.5 8 8 6 10v1.5h8V10l-2-2-.7-4.5', 'M10 11.5V16.5'] },
  toggle: { vb: 20, rects: [[2, 6.5, 16, 7, 3.5]], circles: [[13.5, 10, 2, true]] },
  chevronDown: { vb: 20, paths: ['m6 8 4 4 4-4'], sw: 1.8 },
  chevronRight: { vb: 12, paths: ['M4.5 2.5L8 6l-3.5 3.5'], sw: 1.4 },
  arrowLeft: { vb: 20, paths: ['M11.5 5 6.5 10l5 5', 'M6.5 10h9'], sw: 1.6 },
  more: { vb: 20, circles: [[5, 10, 1.4, true], [10, 10, 1.4, true], [15, 10, 1.4, true]] },
  pencil: { vb: 20, paths: ['m12.9 4.2 2.9 2.9-8.1 8.1-3.5.6.6-3.5z', 'm11.6 5.5 2.9 2.9'] },
  info: { vb: 20, paths: ['M10 9v4.5', 'M10 6.5v.01'], circles: [[10, 10, 7.5]] },
  copy: { vb: 20, paths: ['M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7'], rects: [[7, 7, 9, 9, 1.5]] },
  trash: { vb: 20, paths: ['M4 6h12', 'M8 6V4.5h4V6', 'M5.8 6l.7 10.5h7l.7-10.5', 'M8.5 9v5M11.5 9v5'] },
  gear: {
    vb: 24,
    paths: ['M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'],
    circles: [[12, 12, 3]],
    sw: 2,
  },
  // ── 规则类型图标（interceptor，与 RuleType 一一对应） ──
  redirect: { vb: 20, paths: ['M3.5 15.5v-5a4 4 0 0 1 4-4h8', 'M12.5 3.5l3 3-3 3'] },
  replace: { vb: 20, paths: ['M4 7h11l-2.8-2.8', 'M16 13H5l2.8 2.8'] },
  queryParam: { vb: 20, paths: ['M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'M7.9 8a2.2 2.2 0 1 1 3 2.2c-.6.3-.9.8-.9 1.4', 'M10 14.4v.01'] },
  cancel: { vb: 20, paths: ['M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'M4.9 4.9l10.2 10.2'] },
  delay: { vb: 20, paths: ['M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'M10 6v4.2l2.8 1.7'] },
  headers: { vb: 20, paths: ['M3.5 5.5h13', 'M3.5 10h13', 'M3.5 14.5h7'] },
  userAgent: { vb: 20, paths: ['M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M4 16.5a6 6 0 0 1 12 0'] },
  request: { vb: 20, paths: ['M10 13.5v-10', 'M6.5 7L10 3.5 13.5 7', 'M3.5 16.5h13'] },
  response: { vb: 20, paths: ['M10 3.5v10', 'M6.5 10l3.5 3.5L13.5 10', 'M3.5 16.5h13'] },
  script: { vb: 20, paths: ['M7.6 6.6 4.2 10l3.4 3.4', 'M12.4 6.6 15.8 10l-3.4 3.4'] },
} satisfies Record<string, IconDef>

export type IconName = keyof typeof icons
