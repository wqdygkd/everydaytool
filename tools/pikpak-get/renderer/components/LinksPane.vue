<script setup lang="ts">
import type { PikpakGetLink } from '../../../../shared/pikpak-get'
import { toast } from 'vue-sonner'
import { usePikpakGetStore } from '../stores/pikpakGetStore'

const store = usePikpakGetStore()

const links = computed(() => store.links)
const parsingLinkId = computed(() => store.parsingLinkId)
const selectedLinkId = computed(() => store.selectedLinkId)
const connected = computed(() => Boolean(store.connection))
const parsing = computed(() => Boolean(store.parsingLinkId))

const newUrl = ref('')
const newFolder = ref('')
const newPassCode = ref('')
const busyAdd = ref(false)

async function addLink(): Promise<void> {
  if (!newUrl.value.trim()) {
    toast.warning('请输入分享链接')
    return
  }
  busyAdd.value = true
  try {
    await store.addLink(newUrl.value.trim(), newFolder.value.trim() || undefined, newPassCode.value.trim() || undefined)
    newUrl.value = ''
    newFolder.value = ''
    newPassCode.value = ''
    toast.success('已添加分享链接')
  } catch (error) {
    toast.error((error as Error).message || '添加失败')
  } finally {
    busyAdd.value = false
  }
}

async function select(linkId: string): Promise<void> {
  try {
    await store.selectLink(linkId)
  } catch (error) {
    toast.error((error as Error).message || '解析失败')
  }
}

async function remove(linkId: string): Promise<void> {
  try {
    await store.deleteLink(linkId)
    toast.success('已删除链接')
  } catch (error) {
    toast.error((error as Error).message || '删除失败')
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

const editingLink = ref<PikpakGetLink | null>(null)
const editUrl = ref('')
const editTitle = ref('')
const editFolder = ref('')
const editPassCode = ref('')
const editingOpen = computed({
  get: () => editingLink.value !== null,
  set: (value) => {
    if (!value) editingLink.value = null
  },
})

function openEdit(link: PikpakGetLink): void {
  editingLink.value = link
  editUrl.value = link.url
  editTitle.value = link.title
  editFolder.value = link.folder
  editPassCode.value = link.passCode
}

async function saveEdit(): Promise<void> {
  const link = editingLink.value
  if (!link) return
  const nextUrl = editUrl.value.trim()
  if (!nextUrl) {
    toast.warning('分享链接不能为空')
    return
  }
  try {
    await store.updateLink(link.id, {
      url: nextUrl !== link.url ? nextUrl : undefined,
      title: editTitle.value.trim(),
      folder: editFolder.value.trim() || link.folder,
      passCode: editPassCode.value.trim(),
    })
    editingLink.value = null
    toast.success('已保存修改')
  } catch (error) {
    toast.error((error as Error).message || '保存失败')
  }
}
</script>

<template>
  <div class="links-pane">
    <ToolFormSection title="分享链接" :divider="false">
      <template #actions>
        <span class="count-chip mono">{{ links.length }}</span>
      </template>

      <div class="add-form">
        <UiInput v-model="newUrl" input-type="url" placeholder="分享链接 https://mypikpak.com/s/xxx" />
        <div class="add-row">
          <UiInput v-model="newPassCode" placeholder="提取密码（可选）" />
          <UiInput v-model="newFolder" placeholder="归档目录（可选）" />
        </div>
        <UiButton type="primary" :disabled="busyAdd" @click="addLink">
          添加链接
        </UiButton>
      </div>

      <div v-if="!connected" class="empty-block">
        <UiEmpty text="请先在上方配置并连接引擎" />
      </div>
      <div v-else-if="!links.length" class="empty-block">
        <UiEmpty text="尚未添加分享链接" />
      </div>
      <div v-else class="link-list">
        <div
          v-for="link in links"
          :key="link.id"
          class="link-row"
          :class="{ 'is-selected': selectedLinkId === link.id, 'is-parsing': parsing && parsingLinkId === link.id }"
          @click="select(link.id)"
        >
          <div class="link-main">
            <div class="link-title">
              {{ link.title || link.url }}
              <UiChip v-if="link.passCode" tone="primary" variant="soft" mono>
                提取码
              </UiChip>
            </div>
            <div class="link-meta mono">
              {{ link.folder }}<template v-if="link.parsedAt">
                · {{ formatTime(link.parsedAt) }}
              </template>
            </div>
          </div>
          <div class="link-actions">
            <UiIconButton icon="pencil" label="编辑链接" @click.stop="openEdit(link)" />
            <UiIconButton icon="trash" label="删除链接" @click.stop="remove(link.id)" />
          </div>
        </div>
      </div>
    </ToolFormSection>

    <UiDialog v-model="editingOpen" title="编辑分享链接" width="480px">
      <div class="edit-form">
        <UiFormField label="分享链接">
          <UiInput v-model="editUrl" input-type="url" placeholder="https://mypikpak.com/s/xxx" />
        </UiFormField>
        <UiFormField label="标题">
          <UiInput v-model="editTitle" placeholder="自定义标题（可选）" />
        </UiFormField>
        <UiFormField label="提取密码">
          <UiInput v-model="editPassCode" placeholder="提取密码（留空清除）" />
        </UiFormField>
        <UiFormField label="归档目录">
          <UiInput v-model="editFolder" placeholder="归档目录" />
        </UiFormField>
      </div>
      <template #footer>
        <UiButton @click="editingOpen = false">
          取消
        </UiButton>
        <UiButton type="primary" @click="saveEdit">
          保存
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped lang="scss">
.links-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.add-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.add-row {
  display: flex;
  gap: var(--spacing-sm);
}

.count-chip {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.empty-block {
  padding: var(--spacing-sm) 0;
}

.link-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.link-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out);

  &:hover {
    background: color-mix(in srgb, var(--color-primary) 7%, transparent);
  }

  &.is-selected {
    border-color: color-mix(in srgb, var(--color-primary) 17%, transparent);
    background: color-mix(in srgb, var(--color-primary) 9%, transparent);
  }
}

.link-main {
  flex: 1;
  min-width: 0;
}

.link-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-meta {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-actions {
  display: flex;
  flex: none;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.link-row:hover .link-actions,
.link-row.is-selected .link-actions {
  opacity: 1;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}
</style>
