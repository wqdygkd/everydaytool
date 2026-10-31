import { toast } from 'vue-sonner'

/**
 * 统一剪贴板复制：空值警告 / 成功 / 失败提示一致。
 * @returns 是否复制成功
 */
export async function useCopy(text: string | null | undefined, label = '内容'): Promise<boolean> {
  if (!text) {
    toast.warning(`${label}为空`)
    return false
  }
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label}已复制`)
    return true
  } catch {
    toast.error('复制失败')
    return false
  }
}
