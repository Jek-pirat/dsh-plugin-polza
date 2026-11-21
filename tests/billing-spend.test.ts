import { describe, expect, it } from 'vitest'
import { classifyBilling } from '../src/billing.ts'
import { cacheHitRate, priceRub } from '../src/spend.ts'

describe('402 от Пользы', () => {
  it('отличает нехватку баланса от лимита ключа', () => {
    expect(classifyBilling({ status: 402, message: 'Недостаточно средств. Требуется: 1 ₽, доступно: 0,40 ₽ (баланс: 0,40 ₽)' })).toBe('balance')
    expect(classifyBilling({ status: 402, message: 'Достигнут дневной лимит по сумме' })).toBe('key-limit')
    expect(classifyBilling({ message: '402 {"error":{"code":"INSUFFICIENT_BALANCE","message":"Insufficient funds"}}' })).toBe('balance')
    expect(classifyBilling({ status: 500, message: 'upstream error' })).toBeUndefined()
  })

})

describe('расход и кэш', () => {
  const model = { pricing: { promptPerMillion: 100, completionPerMillion: 500, cacheReadPerMillion: 10, cacheWritePerMillion: 125 } } as never
  it('считает рубли по всем видам токенов', () => {
    expect(priceRub(model, { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBeCloseTo(100 + 50 + 10)
    expect(priceRub(undefined, { inputTokens: 10 })).toBeNull()
  })
  it('доля кэша — от всего входа', () => {
    expect(cacheHitRate({ input: 4, output: 3, cacheRead: 7577, cacheWrite: 603 })).toBeCloseTo(7577 / 8184)
    expect(cacheHitRate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  })
})
