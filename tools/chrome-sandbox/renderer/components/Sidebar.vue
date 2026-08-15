<script setup lang="ts">
import type { Sandbox } from '../../../../shared/types'

withDefaults(defineProps<{
  sandboxes?: Sandbox[]
  selectedId?: string | null
}>(), {
  sandboxes: () => [],
  selectedId: null,
})

defineEmits<{
  select: [id: string]
  create: []
  settings: []
}>()
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-title">
      沙箱列表
    </div>
    <div class="sandbox-list">
      <SandboxCard
        v-for="sandbox in sandboxes"
        :key="sandbox.id"
        :sandbox="sandbox"
        :active="sandbox.id === selectedId"
        @click="$emit('select', sandbox.id)"
      />
      <div v-if="sandboxes.length === 0" class="empty-tip">
        暂无沙箱，点击下方创建
      </div>
    </div>
    <div class="sidebar-actions">
      <el-button type="primary" class="full-width" @click="$emit('create')">
        + 新建沙箱
      </el-button>
      <el-button class="full-width" @click="$emit('settings')">
        全局设置
      </el-button>
    </div>
  </aside>
</template>
