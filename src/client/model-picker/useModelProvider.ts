import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PolzaStore } from '../api.ts'

export function useModelProvider(store: PolzaStore, model: string | undefined, open: boolean) {
  const { state } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [list, setList] = useState<{ model: string; providers: string[] }>()
  const [loadError, setLoadError] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [reloadCount, setReloadCount] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || model === undefined) return
    let active = true
    setLoadError(undefined)
    setSaveError(undefined)
    void store.modelProviders(model).then(
      providers => { if (active) setList({ model, providers }) },
      () => { if (active) setLoadError(model) },
    )
    return () => { active = false }
  }, [model, open, reloadCount, store])

  const ready = state !== null && model !== undefined
  const loaded = list !== undefined && list.model === model
  const loadFailed = loadError !== undefined && loadError === model

  return {
    selected: model === undefined ? '' : state?.prefs.modelProviders[model] ?? '',
    providers: loaded ? list.providers : [],
    status: loaded || loadFailed ? 'idle' : 'loading',
    error: saveError !== undefined && saveError === model ? 'save' : loadFailed ? 'load' : null,
    ready,
    saving,
    reload: () => { setReloadCount(count => count + 1) },
    save: async (provider: string) => {
      if (model === undefined) return false
      setSaving(true)
      setSaveError(undefined)
      try {
        await store.saveModelProvider(model, provider || null)
        return true
      } catch {
        setSaveError(model)
        return false
      } finally {
        setSaving(false)
      }
    },
  }
}
