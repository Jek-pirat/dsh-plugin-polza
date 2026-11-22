import { AsyncLocalStorage } from 'node:async_hooks'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm'
import { classifyBilling } from './billing.ts'
import type { BillingAlert } from './billing.ts'

interface GatewayError {
  status?: number
  code?: string
  message?: string
}

interface RequestState {
  apiKey: string | undefined
  error: GatewayError | undefined
  reasoningEffort: string | undefined
}

const requestState = new AsyncLocalStorage<RequestState>()
const MAX_ERROR_BYTES = 64 * 1024

export function gatewayRequest(): Pick<RequestState, 'reasoningEffort'> | undefined {
  return requestState.getStore()
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function decodeError(body: string): GatewayError | undefined {
  if (!body.trimStart().startsWith('{')) return undefined
  try {
    const value = JSON.parse(body) as { error?: unknown; message?: unknown; detail?: unknown; code?: unknown }
    const nested = value.error as { message?: unknown; code?: unknown } | undefined
    const message = nonEmpty(nested?.message) ?? nonEmpty(value.error) ?? nonEmpty(value.message) ?? nonEmpty(value.detail)
    const code = nonEmpty(nested?.code) ?? nonEmpty(value.code)
    return message === undefined ? undefined : { message, ...(code === undefined ? {} : { code }) }
  } catch {
    return undefined
  }
}

/** Inspect a bounded copy of an error response without consuming the SDK's body. */
async function readErrorBody(response: Response): Promise<string> {
  const reader = response.clone().body?.getReader()
  if (reader === undefined) return ''
  const decoder = new TextDecoder()
  let text = ''
  let remaining = MAX_ERROR_BYTES
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return text + decoder.decode()
      if (value.byteLength > remaining) return text + decoder.decode(value.subarray(0, remaining)) + '…'
      text += decoder.decode(value, { stream: true })
      remaining -= value.byteLength
    }
  } finally {
    // On a tee, cancellation can wait for the SDK to consume the other branch.
    void reader.cancel().catch(() => {})
  }
}

export function gatewayFetch(fetch: typeof globalThis.fetch, apiKey: string | undefined): typeof globalThis.fetch {
  const state = requestState.getStore()
  if (state === undefined) return fetch
  state.apiKey = apiKey
  return async (...args) => {
    state.error = undefined
    const response = await fetch(...args)
    const json = /\b(?:application\/json|[\w.-]+\+json)\b/iu.test(response.headers.get('content-type') ?? '')
    if (!response.ok || json) {
      const body = await readErrorBody(response).catch(() => '')
      const error = decodeError(body)
      if (!response.ok) {
        const message = error?.message ?? nonEmpty(body)
        state.error = { ...error, status: response.status, ...(message === undefined ? {} : { message }) }
      } else if (error !== undefined) {
        state.error = error
      }
    }
    return response
  }
}

function displayFailure(failure: LlmFailure, state: RequestState, report: (alert: BillingAlert) => void): LlmFailure {
  // The OpenAI client already forwards the message of in-band SSE errors.
  const gateway = state.error ?? decodeError(failure.message)
  const original = gateway?.message ?? failure.message
  const message = state.apiKey ? original.replaceAll(state.apiKey, '[REDACTED]') : original
  const status = gateway?.status ?? failure.status
  const billing = classifyBilling({ ...gateway, message, ...(status === undefined ? {} : { status }) })
  if (billing !== undefined) report({ kind: billing, message, at: Date.now() })

  // The stock chat substitutes its own translations for these codes.
  let code = failure.code
  if (billing !== undefined) code = 'POLZA_PAYMENT_REQUIRED'
  else if (state.apiKey !== undefined || gateway !== undefined) {
    if (code === 'AUTH' || code === 'QUOTA' || code === 'ACCOUNT_QUOTA' || code === 'ACCOUNT_SIGN_IN_REQUIRED') code = `POLZA_${code}`
  }
  if (message === failure.message && code === failure.code && status === failure.status) return failure
  return { ...failure, code, message, ...(status === undefined ? {} : { status }) }
}

export async function* withGatewayErrors(
  stream: () => AsyncIterable<StreamChunk>,
  report: (alert: BillingAlert) => void,
  reasoningEffort?: string,
): AsyncIterable<StreamChunk> {
  const state: RequestState = { apiKey: undefined, error: undefined, reasoningEffort }
  let iterator: AsyncIterator<StreamChunk> | undefined
  try {
    const source = requestState.run(state, () => stream()[Symbol.asyncIterator]())
    iterator = source
    while (true) {
      const { done, value } = await requestState.run(state, () => source.next())
      if (done) {
        iterator = undefined
        return
      }
      if (value.type === 'finish' && value.reason.kind === 'error') {
        const failure = displayFailure(value.reason.failure, state, report)
        yield { ...value, reason: { kind: 'error', failure } }
      } else {
        yield value
      }
    }
  } catch (error) {
    if (error instanceof LlmError) {
      const failure = displayFailure(error.failure, state, report)
      if (failure !== error.failure) throw new LlmError(failure.message, failure.code, failure)
    }
    throw error
  } finally {
    await requestState.run(state, () => iterator?.return?.())
  }
}
