// 消息目录名：磁盘上是 15 位补零 id（`000000000000902`），
// 索引 / IPC 里是数字字符串（`902`）。两者不能混用。

/** 消息目录名（15 位补零）；非法消息号直接抛错 */
export function archiveMessageDirName(messageId: number): string {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) throw new Error('消息 id 非法')
  return String(messageId).padStart(15, '0')
}
