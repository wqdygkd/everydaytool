<script setup lang="ts">
import { useDialogVisible } from '@renderer/shared/composables/useDialogVisible'
import { invokeIpc, ipcChannels } from '@renderer/shared/ipc/useIpc'

const props = defineProps({
  modelValue: Boolean,
  fingerprint: { type: Object, default: null },
  sandboxId: { type: String, default: null },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const loading = ref(false)
const local = ref(null)
const visible = useDialogVisible(props, emit)
const channels = ipcChannels()

watch(
  () => props.fingerprint,
  (value) => {
    local.value = value ? JSON.parse(JSON.stringify(value)) : null
  },
  { immediate: true, deep: true },
)

async function randomize() {
  local.value = await invokeIpc(channels.FINGERPRINT_GENERATE_RANDOM)
}

async function save() {
  if (!props.sandboxId || !local.value) return
  loading.value = true
  try {
    await invokeIpc(channels.FINGERPRINT_UPDATE, props.sandboxId, local.value)
    ElMessage.success('指纹已更新')
    visible.value = false
    emit('saved')
  } catch (error) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="编辑指纹" width="640px">
    <el-form v-if="local" :model="local" label-width="120px">
      <el-form-item label="User-Agent">
        <el-input v-model="local.navigator.userAgent" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="Platform">
        <el-input v-model="local.navigator.platform" />
      </el-form-item>
      <el-form-item label="分辨率">
        <div class="inline-fields">
          <el-input-number v-model="local.screen.width" :min="800" />
          <span>x</span>
          <el-input-number v-model="local.screen.height" :min="600" />
        </div>
      </el-form-item>
      <el-form-item label="Canvas 噪点">
        <el-select v-model="local.canvas.noiseLevel">
          <el-option label="低" value="low" />
          <el-option label="中" value="medium" />
          <el-option label="高" value="high" />
        </el-select>
      </el-form-item>
      <el-form-item label="WebGL Vendor">
        <el-input v-model="local.webgl.vendor" />
      </el-form-item>
      <el-form-item label="WebGL Renderer">
        <el-input v-model="local.webgl.renderer" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="randomize">
        随机生成
      </el-button>
      <el-button type="primary" :loading="loading" @click="save">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.inline-fields {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
