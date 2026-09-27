import { gsap } from 'gsap'

export { gsap }

export type MotionScope = ReturnType<typeof gsap.matchMedia>

/**
 * 创建一个受 `prefers-reduced-motion` 控制的动画作用域。
 *
 * `animate` 回调仅在用户**未**启用系统"减少动效"时执行；
 * 命中 reduce 时回调不执行，元素保持自然终态（无闪烁）。
 * `scope` 限定回调内选择器的作用域（传入组件根 ref），避免匹配到组件外部节点。
 *
 * 返回的 `mm` 需在组件 `onUnmounted` 调用 `.revert()`，以 kill 其内所有 tween 并回滚内联样式。
 */
export function createMotionScope(
  animate: () => void,
  scope: Element | string,
): MotionScope {
  const mm = gsap.matchMedia()
  mm.add('(prefers-reduced-motion: no-preference)', () => animate(), scope)
  return mm
}
