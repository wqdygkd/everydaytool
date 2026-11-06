import type {
  FavoriteCategory,
  FavoriteItem,
  FavoritesFile,
  FavoriteSnapshot,
  SkillOrigin,
} from '../../../../shared/skill-manager.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { skillOriginKey } from '../../../../shared/skill-manager.ts'

export const DEFAULT_FAVORITE_CATEGORIES: FavoriteCategory[] = [
  { id: 'engineering', name: '开发规范', icon: 'code', order: 0, builtin: true },
  { id: 'design', name: 'UI / 设计', icon: 'layers', order: 1, builtin: true },
  { id: 'writing', name: '文档与写作', icon: 'pencil', order: 2, builtin: true },
  { id: 'testing', name: '测试与质量', icon: 'play', order: 3, builtin: true },
  { id: 'ops', name: '运维与工具', icon: 'gear', order: 4, builtin: true },
]

export function emptyFavorites(): FavoritesFile {
  return { version: 1, categories: DEFAULT_FAVORITE_CATEGORIES.map(category => ({ ...category })), items: {} }
}

function validCategory(value: unknown): value is FavoriteCategory {
  if (typeof value !== 'object' || value === null) return false
  const category = value as Record<string, unknown>
  return typeof category.id === 'string' && typeof category.name === 'string' && typeof category.order === 'number'
}

function validFavorite(value: unknown): value is FavoriteItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && Array.isArray(item.categories)
    && typeof item.origin === 'object'
    && item.origin !== null
}

export function readFavorites(path: string): FavoritesFile {
  const value = readJsonDocument<FavoritesFile>(path, emptyFavorites)
  if (!value || value.version !== 1 || !Array.isArray(value.categories) || typeof value.items !== 'object' || value.items === null) {
    return emptyFavorites()
  }
  return {
    version: 1,
    categories: value.categories.filter(validCategory).sort((a, b) => a.order - b.order),
    items: Object.fromEntries(Object.entries(value.items).filter(([, item]) => validFavorite(item))),
  }
}

export function writeFavorites(file: FavoritesFile, path: string): FavoritesFile {
  writeJsonDocument(path, file)
  return file
}

function categoryIds(file: FavoritesFile): Set<string> {
  return new Set(file.categories.map(category => category.id))
}

function cleanCategories(file: FavoritesFile, categories: string[] | undefined): string[] {
  const valid = categoryIds(file)
  return [...new Set((categories ?? []).filter(category => valid.has(category)))]
}

export function setFavorite(
  file: FavoritesFile,
  origin: SkillOrigin,
  name: string,
  favorite: boolean,
  categories?: string[],
  snapshot?: FavoriteSnapshot,
): FavoritesFile {
  const key = skillOriginKey(origin)
  if (!favorite) {
    delete file.items[key]
    return file
  }
  const existing = file.items[key]
  const now = new Date().toISOString()
  file.items[key] = {
    id: key,
    name,
    displayName: existing?.displayName,
    origin,
    categories: categories === undefined ? existing?.categories ?? [] : cleanCategories(file, categories),
    note: existing?.note,
    createdAt: existing?.createdAt ?? now,
    lastSeenAt: now,
    snapshot: snapshot ?? existing?.snapshot,
  }
  return file
}

export function updateFavorite(
  file: FavoritesFile,
  key: string,
  update: { categories?: string[], note?: string, displayName?: string },
): FavoritesFile {
  const item = file.items[key]
  if (!item) throw new Error('收藏不存在')
  if (update.categories !== undefined) item.categories = cleanCategories(file, update.categories)
  if (update.note !== undefined) item.note = update.note.trim() || undefined
  if (update.displayName !== undefined) item.displayName = update.displayName.trim() || undefined
  return file
}

function slug(value: string): string {
  const base = value.trim().toLowerCase().replace(/[^a-z0-9\u4E00-\u9FA5]+/g, '-').replace(/^-|-$/g, '')
  return base || `category-${Date.now()}`
}

export function saveCategory(file: FavoritesFile, request: { id?: string, name: string, icon?: string, order?: number }): FavoritesFile {
  const name = request.name.trim()
  if (!name) throw new Error('分类名称不能为空')
  if (name.length > 40) throw new Error('分类名称过长')
  const existing = request.id ? file.categories.find(category => category.id === request.id) : undefined
  if (existing) {
    existing.name = name
    if (request.icon) existing.icon = request.icon
    if (request.order !== undefined) existing.order = request.order
  }
  else {
    const id = request.id ? slug(request.id) : slug(name)
    if (file.categories.some(category => category.id === id)) throw new Error('分类 ID 已存在')
    file.categories.push({
      id,
      name,
      icon: request.icon,
      order: request.order ?? (Math.max(-1, ...file.categories.map(category => category.order)) + 1),
    })
  }
  file.categories.sort((a, b) => a.order - b.order)
  return file
}

export function deleteCategory(file: FavoritesFile, id: string): FavoritesFile {
  const category = file.categories.find(item => item.id === id)
  if (!category) throw new Error('分类不存在')
  if (category.builtin) throw new Error('内置分类不能删除')
  file.categories = file.categories.filter(item => item.id !== id)
  for (const item of Object.values(file.items)) {
    item.categories = item.categories.filter(categoryId => categoryId !== id)
  }
  return file
}
