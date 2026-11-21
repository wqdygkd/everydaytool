/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultOutlookPasswordOptions,
  generateOutlookIdentity,
  generateOutlookPassword,
  generateOutlookProfile,
  isOutlookEmail,
  normalizeOutlookPasswordOptions,
  OUTLOOK_REGISTER_PARTITION_PREFIX,
  outlookPartition,
  splitOutlookEmail,
  validateOutlookPassword,
  withOutlookDomain,
} from '../../../shared/outlook-register.ts'

test('generates a valid outlook identity', () => {
  const identity = generateOutlookIdentity('@outlook.com')
  assert.match(identity.email, /^[a-z][a-z0-9]{11,13}@outlook\.com$/)
  assert.equal(identity.email, `${identity.local}@outlook.com`)
  assert.equal(identity.domain, '@outlook.com')
  assert.ok(identity.password.length >= 12 && identity.password.length <= 16)
  assert.match(identity.password, /[A-Z]/)
  assert.match(identity.password, /[a-z]/)
  assert.match(identity.password, /\d/)
  assert.match(identity.password, /[!@#$%^&*]/)
  assert.ok(identity.profile.birthMonth >= 1 && identity.profile.birthMonth <= 12)
  assert.ok(identity.profile.birthDay >= 1 && identity.profile.birthDay <= 28)
})

test('avoids existing email addresses', () => {
  const first = generateOutlookIdentity('@hotmail.com')
  const second = generateOutlookIdentity('@hotmail.com', [first.email])
  assert.notEqual(first.email, second.email)
  assert.match(second.email, /@hotmail\.com$/)
})

test('password generator always satisfies complexity rules', () => {
  for (let index = 0; index < 50; index += 1) {
    const password = generateOutlookPassword()
    assert.ok(password.length >= 11)
    assert.match(password, /[A-Z]/)
    assert.match(password, /[a-z]/)
    assert.match(password, /\d/)
    assert.match(password, /[!@#$%^&*]/)
    assert.equal(validateOutlookPassword(password), null)
  }
})

test('password generator honors length and character classes', () => {
  const password = generateOutlookPassword({
    length: 12,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: false,
  })
  assert.equal(password.length, 12)
  assert.match(password, /[A-Z]/)
  assert.match(password, /[a-z]/)
  assert.match(password, /\d/)
  assert.doesNotMatch(password, /[!@#$%^&*]/)
  assert.equal(validateOutlookPassword(password), null)
})

test('password validation rejects weak or out-of-range values', () => {
  assert.ok(validateOutlookPassword(''))
  assert.ok(validateOutlookPassword('alllowercase'))
  assert.ok(validateOutlookPassword(['Aa1!', 'Bb2@'].join(' ')))
  assert.ok(validateOutlookPassword('Aa1!'.repeat(5)))
  assert.equal(validateOutlookPassword(['Aa', '1!', 'Bb', '2@'].join('')), null)
})

test('password options fall back to defaults when fewer than three classes remain', () => {
  const normalized = normalizeOutlookPasswordOptions({
    length: 99,
    uppercase: false,
    lowercase: false,
    digits: false,
    symbols: false,
  })
  assert.deepEqual(normalized, defaultOutlookPasswordOptions())
})

test('profile stays inside the signup form ranges', () => {
  for (let index = 0; index < 30; index += 1) {
    const profile = generateOutlookProfile()
    assert.ok(profile.birthYear >= 1965 && profile.birthYear <= 2003)
    assert.ok(profile.birthMonth >= 1 && profile.birthMonth <= 12)
    assert.ok(profile.birthDay >= 1 && profile.birthDay <= 28)
    assert.ok(profile.firstName.length > 0)
    assert.ok(profile.lastName.length > 0)
  }
})

test('normalizes outlook email domains', () => {
  assert.equal(isOutlookEmail('Name@Outlook.com'), true)
  assert.equal(isOutlookEmail('name@example.com'), false)
  assert.deepEqual(splitOutlookEmail('Name@Hotmail.com'), { local: 'name', domain: '@hotmail.com' })
  assert.equal(withOutlookDomain('Name@outlook.com', '@hotmail.com'), 'name@hotmail.com')
})

test('uses a dedicated persistent partition per account', () => {
  assert.equal(outlookPartition('abc-123'), `${OUTLOOK_REGISTER_PARTITION_PREFIX}-abc-123`)
  assert.throws(() => outlookPartition('***'), /非法/)
})
