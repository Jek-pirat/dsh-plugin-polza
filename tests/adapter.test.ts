// Реальный PiAiAdapter из dsh-llm-pi-ai против фейковой Пользы (SSE Chat Completions).
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { readFileSync } from 'node:fs'
import { parsePolzaCatalog } from '../src/contract.ts'
import { toPiModel } from '../src/models.ts'
import { buildPolzaProfile, POLZA_AUTH } from '../src/route.ts'

const requests: { auth: string | undefined; body: Record<string, unknown> }[] = []
let baseUrl = ''
const unavailable = new Set<string>()
let rateLimited: string | undefined
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk: Buffer) => { raw += chunk.toString() })
  req.on('end', () => {
    requests.push({ auth: req.headers.authorization, body: JSON.parse(raw) as Record<string, unknown> })
    const upstream = (requests.at(-1)?.body['provider'] as { only?: string[] } | undefined)?.only?.[0]
    if (upstream !== undefined && unavailable.has(upstream)) {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'No available provider' } }))
      return
    }
    if (upstream !== undefined && upstream === rateLimited) {
      res.writeHead(429, { 'content-type': 'application/json', 'Retry-After': '60' })
      res.end(JSON.stringify({ error: { code: 'TOO_MANY_REQUESTS', message: 'Account model limit' } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (data: unknown) => { res.write(`data: ${JSON.stringify(data)}\n\n`) }
    const base = { id: 'gen-1', object: 'chat.completion.chunk', created: 1, model: 'anthropic/claude-sonnet-5.5' }
    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', reasoning: 'думаю…' } }] })
    send({ ...base, choices: [{ index: 0, delta: { content: 'Привет' } }] })
    send({ ...base, choices: [{ index: 0, delta: { content: ' из Пользы' }, finish_reason: 'stop' }] })
    send({ ...base, choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } })
    res.end('data: [DONE]\n\n')
  })
})

beforeAll(async () => {
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`
})
afterAll(() => { server.close() })

function adapter(modelProviders?: (id: string) => readonly string[] | undefined) {
  const catalog = parsePolzaCatalog(JSON.parse(readFileSync(new URL('./fixtures/catalog.json', import.meta.url), 'utf8')))
  const models = catalog.map(model => toPiModel(model, 'polza', baseUrl))
  const profiles = new Map([['polza', buildPolzaProfile({ models, keyRef: credentialRef('POLZA_API_KEY'), modelProviders })]])
  return new PiAiAdapter({ profiles: () => profiles, resolveApiKey: () => Promise.resolve('pza_test_key_123456'), auth: POLZA_AUTH })
}

describe('polza route on PiAiAdapter', () => {
  it('lists the configured models and resolves reasoning efforts', async () => {
    const llm = adapter()
    const listed = await llm.listModels('polza')
    expect(listed.map(model => model.id)).toContain('anthropic/claude-sonnet-5.5')
    const info = await llm.resolveModel('polza', 'anthropic/claude-sonnet-5.5')
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'medium', 'high'])
    expect(info.context?.contextWindow).toBe(1_000_000)
  })

  it('pins the first route, tries the next on a known refusal, and leaves auto routing unchanged', async () => {
    const model = 'anthropic/claude-sonnet-5.5'
    const primary = 'amazon-bedrock/eu-west-1'
    const backup = 'anthropic'
    let selected = [primary, backup]
    const call = await adapter(id => id === model ? selected : undefined).prepareCall('polza', model)
    const run = async () => {
      const chunks: StreamChunk[] = []
      for await (const chunk of call.stream({
        provider: 'polza',
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Привет' }] }],
      } as never)) chunks.push(chunk)
      expect(chunks.at(-1)?.type).toBe('finish')
      return requests.at(-1)?.body
    }
    const request = (provider: string) => ({ only: [provider], allow_fallbacks: false })
    expect((await run())?.provider).toEqual(request(primary))
    unavailable.add(primary)
    try {
      const start = requests.length
      expect((await run())?.provider).toEqual(request(backup))
      expect(requests.slice(start).map(entry => entry.body.provider)).toEqual([request(primary), request(backup)])
    } finally { unavailable.delete(primary) }
    selected = [backup, primary]
    expect((await run())?.provider).toEqual(request(backup))
    selected = []
    expect(await run()).not.toHaveProperty('provider')
  })

  it('does not advance to a different provider on an account rate limit', async () => {
    const first = 'anthropic'
    rateLimited = first
    const start = requests.length
    try {
      const chunks: StreamChunk[] = []
      for await (const chunk of adapter(() => [first, 'backup']).stream({
        provider: 'polza',
        model: 'anthropic/claude-sonnet-5.5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Привет' }] }],
      } as never)) chunks.push(chunk)
      expect(chunks.some(chunk => chunk.type === 'text-delta')).toBe(false)
      expect(requests.slice(start).map(entry => entry.body.provider))
        .toEqual([{ only: [first], allow_fallbacks: false }])
    } finally { rateLimited = undefined }
  })

  it('streams text and usage with the Polza wire dialect', async () => {
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter().stream({
      provider: 'polza',
      model: 'anthropic/claude-sonnet-5.5',
      reasoningEffort: 'high',
      maxTokens: 1000,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Привет' }] }],
    } as never)) chunks.push(chunk)

    const request = requests.at(-1)
    expect(request?.auth).toBe('Bearer pza_test_key_123456')
    expect(request?.body).toMatchObject({ model: 'anthropic/claude-sonnet-5.5', stream: true, max_tokens: 1000, reasoning: { effort: 'high' } })
    expect(request?.body).not.toHaveProperty('store')
    expect(request?.body).not.toHaveProperty('provider')

    const text = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => (chunk as { text: string }).text).join('')
    expect(text).toBe('Привет из Пользы')
    const types = chunks.map(chunk => chunk.type)
    expect(types.at(-1)).toBe('finish')
    expect(types.indexOf('usage')).toBeLessThan(types.indexOf('finish'))
  })
})
