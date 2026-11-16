// Настройки плагина из UI: $DSH_HOME/polza/settings.json.
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic.ts'
import { polzaModelSlugSchema } from './contract.ts'

export const DEFAULT_SIDE_MODEL = 'deepseek/deepseek-v4.1-flash-1017'

export interface PolzaPrefs {
  /** Модель для заголовков сессий и сжатия контекста; null — та же, что у разговора. */
  sideModel: string | null
  /** Порог «мало денег» в рублях для предупреждения. */
  lowBalanceRub: number
  /** Явный маршрут для модели. Отсутствие записи включает автомаршрутизацию. */
  modelProviders: Record<string, string>
}

const DEFAULTS: PolzaPrefs = { sideModel: DEFAULT_SIDE_MODEL, lowBalanceRub: 50, modelProviders: {} }

export class PrefsStore {
  private value: PolzaPrefs = { ...DEFAULTS }
  private pending = Promise.resolve()

  constructor(private readonly path: string) {}

  current(): PolzaPrefs { return this.value }

  load(): Promise<void> {
    this.pending = this.pending.then(async () => {
      try {
        this.value = normalize({ ...DEFAULTS, ...JSON.parse(await readFile(this.path, 'utf8')) as object })
      } catch { /* по умолчанию */ }
    })
    return this.pending
  }

  update(patch: Partial<Omit<PolzaPrefs, 'modelProviders'>>): Promise<PolzaPrefs> {
    return this.transact(current => normalize({ ...current, ...patch, modelProviders: current.modelProviders }))
  }

  setModelProvider(model: string, provider: string | null): Promise<PolzaPrefs> {
    return this.transact(current => {
      const modelProviders = { ...current.modelProviders }
      if (provider === null) delete modelProviders[model]
      else modelProviders[model] = provider
      return { ...current, modelProviders }
    })
  }

  private transact(update: (current: PolzaPrefs) => PolzaPrefs): Promise<PolzaPrefs> {
    const operation = this.pending.then(async () => {
      const next = update(this.value)
      await writeFileAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`)
      this.value = next
      return next
    })
    this.pending = operation.then(() => {}, () => {})
    return operation
  }
}

function normalize(raw: Record<string, unknown>): PolzaPrefs {
  const side = raw['sideModel']
  const low = raw['lowBalanceRub']
  const providers = raw['modelProviders']
  const modelProviders = providers !== null && typeof providers === 'object'
    ? Object.fromEntries(Object.entries(providers).filter(([model, provider]) =>
      polzaModelSlugSchema.safeParse(model).success && typeof provider === 'string' && provider.length > 0))
    : {}
  return {
    modelProviders,
    sideModel: side === null || side === '' ? null : polzaModelSlugSchema.safeParse(side).success ? side as string : DEFAULTS.sideModel,
    lowBalanceRub: typeof low === 'number' && Number.isFinite(low) && low >= 0 ? low : DEFAULTS.lowBalanceRub,
  }
}
