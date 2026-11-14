/** 锁文件键也是目录名 / 回收站目标名，读锁时先按同一套规则校验。 */
export function isSafeSkillKey(name: string): boolean {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 80
    && !name.startsWith('.')
    && /^[\w.-]+$/.test(name)
}
