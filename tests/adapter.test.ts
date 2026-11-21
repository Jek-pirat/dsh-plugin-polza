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
import { withGatewayErrors } from '../src/gateway-errors.ts'

const requests: { auth: string | undefined; body: Record<string, unknown> }[] = []
let baseUrl = ''
const balanceMessage = 'Недостаточно средств. Требуется: 1 ₽, доступно: 0,40 ₽ (баланс: 0,40 ₽)'
const keyLimitMessage = 'Достигнут дневной лимит по сумме. Доступно: 0,40 ₽'
const testApiKey = 'pza_test_key_123456'
const gatewayFailures = [
  { name: 'validation', status: 400, payload: { error: { message: 'Поле temperature должно быть числом' } }, message: 'Поле temperature должно быть числом', code: 'INVALID_REQUEST' },
  { name: 'authentication', status: 401, payload: { message: `Ключ ${testApiKey} отозван` }, message: 'Ключ [REDACTED] отозван', code: 'POLZA_AUTH' },
  { name: 'balance', status: 402, payload: { error: { code: 'INSUFFICIENT_BALANCE', message: balanceMessage } }, message: balanceMessage, code: 'POLZA_PAYMENT_REQUIRED', billing: 'balance' },
  { name: 'key limit', status: 402, payload: { error: { code: 'INSUFFICIENT_BALANCE', message: keyLimitMessage } }, message: keyLimitMessage, code: 'POLZA_PAYMENT_REQUIRED', billing: 'key-limit' },
  { name: 'policy', status: 403, payload: { error: 'Ключу запрещён доступ к этой модели' }, message: 'Ключу запрещён доступ к этой модели', code: 'POLZA_AUTH' },
  { name: 'not found', status: 404, payload: { detail: 'Указанный маршрут модели не найден' }, message: 'Указанный маршрут модели не найден', code: 'PI_AI_ERROR' },
  { name: 'rate limit', status: 429, payload: { error: { message: 'Слишком много запросов. Повторите позже.' } }, message: 'Слишком много запросов. Повторите позже.', code: 'RATE_LIMIT' },
  { name: 'quota', status: 429, payload: { error: { code: 'QUOTA_EXCEEDED', message: 'Quota exceeded for this model' } }, message: 'Quota exceeded for this model', code: 'POLZA_QUOTA' },
  { name: 'plain text', status: 503, payload: 'Шлюз временно недоступен', message: 'Шлюз временно недоступен', code: 'SERVER' },
  { name: 'json error in success response', status: 200, payload: { error: { message: 'Модель не запустилась' } }, message: 'Модель не запустилась' },
  { name: 'sse', status: 200, stream: true, payload: { error: { message: 'Quota exhausted upstream' } }, message: 'Quota exhausted upstream', code: 'POLZA_QUOTA' },
]
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk: Buffer) => { raw += chunk.toString() })
  req.on('end', () => {
    const body = JSON.parse(raw) as Record<string, unknown>
    requests.push({ auth: req.headers.authorization, body })
    const failure = gatewayFailures.find(({ name }) => JSON.stringify(body.messages).includes(`gateway-test:${name}:`))
    if (failure !== undefined) {
      const plain = typeof failure.payload === 'string'
      res.writeHead(failure.status, { 'content-type': failure.stream ? 'text/event-stream' : plain ? 'text/plain' : 'application/json' })
      res.end(failure.stream ? `event: error\ndata: ${JSON.stringify(failure.payload)}\n\n` : plain ? failure.payload : JSON.stringify(failure.payload))
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
  return new PiAiAdapter({ profiles: () => profiles, resolveApiKey: () => Promise.resolve(testApiKey), auth: POLZA_AUTH })
}

describe('polza route on PiAiAdapter', () => {
  it('keeps each concurrent call’s gateway message and failure type', async () => {
    const model = 'anthropic/claude-sonnet-5.5'
    const call = await adapter().prepareCall('polza', model)
    await Promise.all(gatewayFailures.map(async ({ name, status, message, code, billing }) => {
      const alerts: unknown[] = []
      const chunks: StreamChunk[] = []
      for await (const chunk of withGatewayErrors(() => call.stream({
        provider: 'polza', model,
        messages: [{ role: 'user', content: [{ type: 'text', text: `gateway-test:${name}:` }] }],
      } as never), alert => { alerts.push(alert) })) chunks.push(chunk)
      expect(chunks.at(-1), name).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: {
        message, ...(status >= 400 ? { status } : {}), ...(code === undefined ? {} : { code }),
      } } })
      expect(alerts, name).toEqual(billing === undefined ? [] : [{ kind: billing, message, at: expect.any(Number) }])
    }))
  })

  it('lists the configured models and resolves reasoning efforts', async () => {
    const llm = adapter()
    const listed = await llm.listModels('polza')
    expect(listed.map(model => model.id)).toContain('anthropic/claude-sonnet-5.5')
    const info = await llm.resolveModel('polza', 'anthropic/claude-sonnet-5.5')
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'medium', 'high'])
    expect(info.context?.contextWindow).toBe(1_000_000)
  })

  it('preserves upstream priority for prepared calls and drops routing in auto mode', async () => {
    const model = 'anthropic/claude-sonnet-5.5'
    let selected = ['amazon-bedrock/eu-west-1', 'anthropic']
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
    expect((await run())?.provider).toEqual({
      only: ['amazon-bedrock/eu-west-1', 'anthropic'],
      order: ['amazon-bedrock/eu-west-1', 'anthropic'],
      allow_fallbacks: true,
    })
    selected = ['anthropic', 'amazon-bedrock/eu-west-1']
    expect((await run())?.provider).toMatchObject({ order: ['anthropic', 'amazon-bedrock/eu-west-1'] })
    selected = []
    expect(await run()).not.toHaveProperty('provider')
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
