import type {
  FavoriteCategoryRequest,
  FavoritesView,
  FavoriteToggleRequest,
  FavoriteUpdateRequest,
} from '../../../../shared/skill-manager.ts'
import { skillOriginKey } from '../../../../shared/skill-manager.ts'
import { scanInventoryWithDisabled } from './disabled-service.ts'
import {
  deleteCategory,
  readFavorites,
  saveCategory,
  setFavorite,
  updateFavorite,
  writeFavorites,
} from './favorites.ts'
import { getDefaultFavoritesPath } from './installer.ts'

async function view(): Promise<FavoritesView> {
  const path = getDefaultFavoritesPath()
  const file = readFavorites(path)
  const inventory = await scanInventoryWithDisabled()
  const installed = new Map<string, { scopeIds: string[], state: FavoritesView['items'][number]['state'] }>()
  for (const scope of inventory.scopes) {
    for (const skill of scope.skills) {
      const key = skillOriginKey(skill.origin)
      const current = installed.get(key)
      if (current) current.scopeIds.push(scope.scope.id)
      else installed.set(key, { scopeIds: [scope.scope.id], state: skill.state })
    }
  }
  return {
    file,
    items: Object.entries(file.items).map(([key, item]) => ({
      ...item,
      key,
      installed: installed.has(key),
      scopeIds: installed.get(key)?.scopeIds ?? [],
      state: installed.get(key)?.state,
    })),
  }
}

export async function getFavorites(): Promise<FavoritesView> {
  return view()
}

export async function toggleFavorite(request: FavoriteToggleRequest): Promise<FavoritesView> {
  const path = getDefaultFavoritesPath()
  const file = readFavorites(path)
  setFavorite(file, request.origin, request.name, request.favorite, request.categories, request.snapshot)
  writeFavorites(file, path)
  return view()
}

export async function updateFavoriteItem(request: FavoriteUpdateRequest): Promise<FavoritesView> {
  const path = getDefaultFavoritesPath()
  const file = readFavorites(path)
  updateFavorite(file, request.key, request)
  writeFavorites(file, path)
  return view()
}

export async function saveFavoriteCategory(request: FavoriteCategoryRequest): Promise<FavoritesView> {
  const path = getDefaultFavoritesPath()
  const file = readFavorites(path)
  saveCategory(file, request)
  writeFavorites(file, path)
  return view()
}

export async function deleteFavoriteCategory(id: string): Promise<FavoritesView> {
  const path = getDefaultFavoritesPath()
  const file = readFavorites(path)
  deleteCategory(file, id)
  writeFavorites(file, path)
  return view()
}
