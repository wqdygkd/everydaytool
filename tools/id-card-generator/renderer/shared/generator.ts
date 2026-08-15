import { AREA_CODES } from './area-codes'

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const CHECK_CHARS = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

export const GENDER = {
  MALE: 'male',
  FEMALE: 'female',
  RANDOM: 'random',
} as const

export type Gender = (typeof GENDER)[keyof typeof GENDER]

const GENDER_LABEL: Partial<Record<Gender, string>> = {
  [GENDER.MALE]: '男',
  [GENDER.FEMALE]: '女',
}

export interface IdCardResult {
  id: string
  areaCode: string
  areaName: string
  birthDate: string
  birthDateDisplay: string
  gender: Gender
  genderLabel: string | undefined
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomPick<T>(list: T[]): T {
  return list[randomInt(0, list.length - 1)] as T
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
}

function formatDisplayDate(dateStr: string): string {
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
}

function subtractYears(date: Date, years: number): Date {
  const result = new Date(date)
  result.setFullYear(result.getFullYear() - years)
  return result
}

function randomBirthDate(minAge: number, maxAge: number): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const latestBirth = subtractYears(today, minAge)
  const earliestBirth = subtractYears(today, maxAge)

  const startMs = earliestBirth.getTime()
  const endMs = latestBirth.getTime()
  return formatDate(new Date(startMs + Math.random() * (endMs - startMs)))
}

function randomSequence(gender: Gender): string {
  if (gender === GENDER.MALE) {
    const n = randomInt(0, 499)
    return String(n * 2 + 1).padStart(3, '0')
  }
  if (gender === GENDER.FEMALE) {
    const n = randomInt(1, 499)
    return String(n * 2).padStart(3, '0')
  }
  return String(randomInt(1, 999)).padStart(3, '0')
}

function inferGender(sequence: string): Gender {
  if (Number(sequence.at(-1)) % 2 === 1) return GENDER.MALE
  return GENDER.FEMALE
}

export function calcCheckDigit(body17: string): string {
  const sum = body17.split('').reduce((acc, digit, index) => acc + Number(digit) * WEIGHTS[index], 0)
  return CHECK_CHARS[sum % 11] as string
}

export function generateIdCard(options: { gender?: Gender, minAge?: number, maxAge?: number } = {}): IdCardResult {
  const { gender = GENDER.RANDOM, minAge = 18, maxAge = 60 } = options
  const safeMinAge = Math.max(0, Math.min(minAge, maxAge))
  const safeMaxAge = Math.max(safeMinAge, maxAge)

  const area = randomPick(AREA_CODES)
  const birthDate = randomBirthDate(safeMinAge, safeMaxAge)
  const sequence = randomSequence(gender)
  const body = `${area.code}${birthDate}${sequence}`
  const checkDigit = calcCheckDigit(body)
  const resolvedGender = gender === GENDER.RANDOM ? inferGender(sequence) : gender

  return {
    id: body + checkDigit,
    areaCode: area.code,
    areaName: area.name,
    birthDate,
    birthDateDisplay: formatDisplayDate(birthDate),
    gender: resolvedGender,
    genderLabel: GENDER_LABEL[resolvedGender],
  }
}
