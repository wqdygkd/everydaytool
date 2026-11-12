<script setup lang="ts">
// 每条线路一个 split 按钮：左半「下载到本地」（走内置下载器，有进度与历史），右半「复制该线路链接」。
// 参照 gh-proxy 的资产卡片：线路是下载动作的参数，不做全局预选。
import type { OfflinePackGithubDownloadVariant } from '@shared/offline-pack'
import { useCopy } from '@renderer/shared/composables/useClipboard'
import { githubDownloadVariants } from '@shared/offline-pack'
import { computed } from 'vue'
import { useOfflinePackDownloadsStore } from '../stores/downloads'

const props = defineProps<{
  /** 官方（未加速）下载地址 */
  officialUrl: string
  /** 落盘文件名（由调用方拼好仓库/版本前缀） */
  filename: string
  /** 任务标题：下载抽屉与历史里显示，同时作为「同一文件是否在下载」的判据 */
  title: string
}>()

const downloads = useOfflinePackDownloadsStore()
const variants = computed<OfflinePackGithubDownloadVariant[]>(() => githubDownloadVariants(props.officialUrl))
/** 同名任务在跑时禁用所有线路：同文件并发会写同一个目标，后完成的那次会覆盖前一次 */
const busy = computed(() => downloads.tasks.some(task => task.status === 'running' && task.title === props.title))
/** 最近一次失败：直接贴在按钮下方，用户不用翻抽屉才知道该换线路 */
const failure = computed(() => {
  // tasks 按新到旧排列：只看这个文件最近一次任务，重试或成功后就该收起错误
  const latest = downloads.tasks.find(item => item.title === props.title)
  return latest?.status === 'error' ? latest.error : ''
})

async function download(variant: OfflinePackGithubDownloadVariant): Promise<void> {
  if (busy.value) return
  await downloads.start(
    {
      kind: 'github',
      url: props.officialUrl,
      filename: props.filename,
      mirror: variant.mirror,
    },
    props.title,
  )
}

function downloadTitle(variant: OfflinePackGithubDownloadVariant): string {
  if (busy.value) return '该文件正在下载'
  return variant.id === 'direct'
    ? `直连 GitHub 下载（不走加速）`
    : `通过 ${variant.host} 下载（${variant.label}）`
}

function copyTitle(variant: OfflinePackGithubDownloadVariant): string {
  return variant.id === 'direct'
    ? '复制官方原始链接'
    : `复制 ${variant.host} 加速链接`
}
</script>

<template>
  <div class="line-buttons">
    <div class="line-row">
      <UiSplitButton
        v-for="variant in variants"
        :key="variant.id"
        :label="variant.label"
        :title="downloadTitle(variant)"
        :copy-title="copyTitle(variant)"
        :disabled="busy"
        :recommended="variant.recommended"
        @click="download(variant)"
        @copy="useCopy(variant.url, `${variant.host} 链接`)"
      />
    </div>
    <UiHint v-if="failure" size="xs" class="line-failure">
      {{ failure }}
    </UiHint>
  </div>
</template>

<style scoped lang="scss">
.line-buttons {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}

.line-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  min-width: 0;
}

.line-failure {
  color: var(--color-error);
}
</style>
