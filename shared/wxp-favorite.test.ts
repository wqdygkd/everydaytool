import { describe, expect, it } from 'vitest'
import { normalizeWxpLinkFavorites, parseWxpLinkFavorite, sameWxpLinkFavorite } from './wxp-favorite'

describe('parseWxpLinkFavorite', () => {
  it('对象输入：字段 trim / 数字转字符串补齐，缺 simpleName 丢弃', () => {
    const parsed = parseWxpLinkFavorite({ simpleName: ' 项A ', sceneformal: '场景', code: 123 })
    expect(parsed).toEqual({
      sceneformal: '场景',
      simpleName: '项A',
      accessPoint: '',
      targetPoint: '',
      hospital: '',
      tenantId: '',
      code: '123',
    })
    expect(parseWxpLinkFavorite({ sceneformal: '没有 simpleName' })).toBeNull()
    expect(parseWxpLinkFavorite(null)).toBeNull()
    expect(parseWxpLinkFavorite(42)).toBeNull()
  })

  it('旧版 | 拼接字符串：拆段，多余段并回 targetPoint', () => {
    const parsed = parseWxpLinkFavorite('场景|项B|接入|目标|带|竖|线')
    expect(parsed).toEqual({
      sceneformal: '场景',
      simpleName: '项B',
      accessPoint: '接入',
      targetPoint: '目标|带|竖|线',
      hospital: '',
      tenantId: '',
      code: '',
    })
    expect(parseWxpLinkFavorite('只有场景段|')).toBeNull()
    expect(parseWxpLinkFavorite('无分隔符')).toBeNull()
  })
})

describe('sameWxpLinkFavorite', () => {
  it('只比较四个身份字段（忽略 hospital / tenantId / code）', () => {
    const base = {
      sceneformal: 's',
      simpleName: 'n',
      accessPoint: 'a',
      targetPoint: 't',
      hospital: 'h',
      tenantId: 'x',
      code: 'c',
    }
    expect(sameWxpLinkFavorite(base, { ...base })).toBe(true)
    expect(sameWxpLinkFavorite(base, { ...base, hospital: 'other', tenantId: 'y', code: 'z' })).toBe(true)
    expect(sameWxpLinkFavorite(base, { ...base, targetPoint: 'changed' })).toBe(false)
  })
})

describe('normalizeWxpLinkFavorites', () => {
  it('非数组输入返回空数组，非法条目被丢弃', () => {
    expect(normalizeWxpLinkFavorites(null)).toEqual([])
    expect(normalizeWxpLinkFavorites('x')).toEqual([])
    const good = { simpleName: 'n' }
    expect(normalizeWxpLinkFavorites([good, '场景|项C|接入|目标', 42])).toHaveLength(2)
  })
})
