<script setup lang="ts">
import { useCopy } from '../../composables/useClipboard'

const props = withDefaults(defineProps<{
  /** 待复制的文本 */
  text: string
  /** 复制成功提示中的内容名，如「路径」 */
  label?: string
  size?: 'small' | 'default' | 'large'
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  /** 文字按钮模式（默认图标按钮） */
  textButton?: boolean
}>(), {
  size: 'small',
  type: 'info',
  textButton: false,
})

const emit = defineEmits<{
  copied: []
}>()

async function onClick() {
  const ok = await useCopy(props.text, props.label)
  if (ok) emit('copied')
}
</script>

<template>
  <el-button
    v-if="textButton"
    class="ui-copy-btn"
    :size="size"
    :type="type"
    text
    @click="onClick"
  >
    <UiIcon name="copy" :size="13" />
    <span>复制</span>
  </el-button>
  <el-button
    v-else
    class="ui-copy-btn"
    :size="size"
    :type="type"
    :aria-label="`复制${label}`"
    @click="onClick"
  >
    <UiIcon name="copy" :size="13" />
  </el-button>
</template>
