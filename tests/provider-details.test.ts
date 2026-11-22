import { expect, it } from 'vitest'
import { fetchModelProviders } from '../src/catalog.ts'

it('reads provider prices, unofficial flags and reasoning levels from model details', async () => {
  const providers = [
    { name: 'one', is_unofficial: true, pricing: { currency: 'RUB', prompt_per_million: '9.25408512', completion_per_million: '27.76225536' }, reasoning: { mandatory: false, supported_efforts: ['max', 'high', 'low', 'none'] } },
    { name: 'two', is_unofficial: false, pricing: { currency: 'RUB', prompt_per_million: 0 }, capabilities: { reasoning_effort: { status: 'supported', values: ['xhigh', 'high', 'none'] }, reasoning_toggle: { status: 'ignored' } } },
    { name: 'three', pricing: { currency: 'USD', prompt_per_million: 1, completion_per_million: 2 } },
    { name: 'four' },
    { name: 'one', is_unofficial: false, pricing: { currency: 'RUB', prompt_per_million: 100, completion_per_million: 200 } },
  ]
  const expected = [
    { name: 'one', price: { promptPerMillion: 9.25408512, completionPerMillion: 27.76225536 }, unofficial: true, reasoningLevels: ['off', 'low', 'high', 'max'] },
    { name: 'two', price: { promptPerMillion: 0, completionPerMillion: null }, unofficial: false, reasoningLevels: ['high', 'xhigh'] },
    { name: 'three', price: null, unofficial: false, reasoningLevels: [] },
    { name: 'four', price: null, unofficial: false, reasoningLevels: [] },
  ]
  const load = (payload: unknown) => fetchModelProviders('https://polza.test', 'vendor/model', async () => Response.json(payload))
  await expect(load({ providers })).resolves.toEqual(expected)
  await expect(load({ data: { providers } })).resolves.toEqual(expected)
})
