import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PolzaStore } from './api.ts'
import type { T } from './locale.ts'

interface ModelSelection {
  provider: string
  model: string
}

interface ControlProps {
  t: T
  store: PolzaStore
  useProjection: (key: 'modelSelection') => { next?: ModelSelection | null; lastUsed?: ModelSelection | null } | undefined
}

export function ModelProviderControl({ t, store, useProjection }: ControlProps) {
  const projection = useProjection('modelSelection')
  const selection = projection?.next ?? projection?.lastUsed
  if (selection?.provider !== 'polza') return null
  return <ProviderSelect key={selection.model} model={selection.model} t={t} store={store} />
}

function ProviderSelect({ model, t, store }: { model: string; t: T; store: PolzaStore }) {
  const { state } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [providers, setProviders] = useState<string[] | null>(null)
  const [loadingError, setLoadingError] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const selected = state?.prefs.modelProviders[model] ?? ''

  useEffect(() => {
    let active = true
    void store.modelProviders(model).then(
      names => { if (active) setProviders(names) },
      () => { if (active) setLoadingError(true) },
    )
    return () => { active = false }
  }, [model, store])

  const change = async (value: string) => {
    setSaving(true)
    setSaveError(null)
    try { await store.saveModelProvider(model, value || null) }
    catch (error) { setSaveError(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }

  return (
    <label className="pz-model-provider">
      <span>{t('provider')}</span>
      <select aria-label={t('provider')} value={selected} disabled={state === null || saving || (providers === null && !selected)}
        onChange={event => { void change(event.currentTarget.value) }}>
        <option value="">{!selected && loadingError ? t('providerUnavailable') : !selected && providers === null ? t('providerLoading') : t('providerAuto')}</option>
        {selected && !providers?.includes(selected) ? <option value={selected} disabled>{selected}</option> : null}
        {providers?.map(provider => <option key={provider} value={provider}>{provider}</option>)}
      </select>
      {saveError ? <span role="alert" className="pz-error">{saveError}</span> : null}
    </label>
  )
}
