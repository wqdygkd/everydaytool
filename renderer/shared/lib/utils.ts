// shadcn-vue 生成组件依赖的 cn 工具(components.json 的 utils alias 指向这里)。
// 本文件不属于生成物,可以被修改;shadcn 原始组件在 renderer/shared/components/shadcn/。
import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
