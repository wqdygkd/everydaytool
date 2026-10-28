<script setup lang="ts">
import { useDialogVisible } from '@renderer/shared/composables/useDialogVisible'
import { appIpcChannels, invokeAppIpc } from '@renderer/shared/ipc/useAppIpc'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'completed'])

const loading = ref(false)
/** 当前生效的目录（首次使用时就是默认位置） */
const currentDirectory = ref('')
/** 用户点了「换一个目录」后才展开的输入框 */
const choosing = ref(false)
const pickedDirectory = ref('')
const visible = useDialogVisible(props, emit)

async function loadCurrent(): Promise<void> {
  try {
    const info = await invokeAppIpc<{ dataDirectory: string }>(appIpcChannels().DATA_DIRECTORY_GET)
    currentDirectory.value = info?.dataDirectory ?? ''
  } catch {
    // 网页预览没有 IPC：保持空值，走「换一个目录」自己填
  }
}

watch(visible, async (open) => {
  if (!open)
    return
  choosing.value = false
  pickedDirectory.value = ''
  await loadCurrent()
})

/**
 * 接受一个目录并继续。
 * 与当前目录相同时后端只记「已确认」不迁移——默认位置点一下就能开始用。
 */
async function accept(target: string): Promise<void> {
  const dir = target.trim()
  if (!dir) {
    ElMessage.warning('请先选择或填写数据目录')
    return
  }

  loading.value = true
  try {
    await invokeAppIpc(appIpcChannels().DATA_DIRECTORY_UPDATE, dir)
    visible.value = false
    emit('completed', { dataDirectory: dir })
  } catch (error) {
    ElMessage.error((error as Error).message || '保存失败')
  } finally {
    loading.value = false
  }
}

/** 关掉对话框 = 先用默认位置：不拦路，之后可在「设置 → 数据目录」再改 */
function skip() {
  void accept(currentDirectory.value || '')
}
</script>

<template>
  <UiDialog
    v-model="visible"
    title="首次使用 · 数据目录"
    width="560px"
    :close-on-click-modal="false"
    @close="skip"
  >
    <p class="setup-intro">
      所有工具的配置、登录会话与缓存都放在同一个目录下（沙箱、拦截规则、离线包都算）。
      用默认位置即可开始，之后随时能在「设置 → 数据目录」里换。
    </p>

    <div v-if="!choosing" class="setup-default">
      <span class="setup-label">默认位置</span>
      <code class="setup-path mono" :title="currentDirectory">{{ currentDirectory || '—' }}</code>
    </div>

    <template v-else>
      <el-form label-width="88px">
        <el-form-item label="数据目录">
          <DataDirectoryField v-model="pickedDirectory" />
        </el-form-item>
      </el-form>
      <p class="setup-note">
        换到别的目录会在<strong>下次启动</strong>时整体迁移一次（迁移成功才切换）；
        目标目录需要是空目录。
      </p>
    </template>

    <template #footer>
      <template v-if="!choosing">
        <el-button :disabled="loading" @click="choosing = true">
          换一个目录…
        </el-button>
        <el-button type="primary" :loading="loading" @click="accept(currentDirectory)">
          用默认位置继续
        </el-button>
      </template>
      <template v-else>
        <el-button :disabled="loading" @click="choosing = false">
          返回
        </el-button>
        <el-button type="primary" :loading="loading" @click="accept(pickedDirectory)">
          保存并继续
        </el-button>
      </template>
    </template>
  </UiDialog>
</template>

<style scoped lang="scss">
.setup-intro {
  margin: 0 0 var(--spacing-lg);
  color: var(--color-text-secondary);
  line-height: 1.6;
  max-width: var(--measure-prose);
}

/* 默认位置：一行「标签 + 等宽路径」，比丢一个空输入框更能让人放心点下去 */
.setup-default {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-lg);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-fill);
}

.setup-label {
  flex-shrink: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.setup-path {
  min-width: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  /* 路径整段显示（最多折两行）：截断会把「末级目录」藏掉，而它正是用户确认位置时要看的 */
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.setup-note {
  margin: var(--spacing-sm) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  max-width: var(--measure-prose);
}
</style>
