import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ModelProviders, PolzaStore } from '../api.ts'

const EMPTY: readonly string[] = []

export function useModelProvider(store: PolzaStore, model: string | undefined, open: boolean) {
  const { state } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [list, setList] = useState<{ model: string; data: ModelProviders }>()
  const [loadError, setLoadError] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [reloadCount, setReloadCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const savePending = useRef(false)

  useEffect(() => {
    if (!open || model === undefined) return
    let active = true
    setLoadError(undefined)
    setSaveError(undefined)
    void store.modelProviders(model).then(
      data => { if (active) setList({ model, data }) },
      () => { if (active) setLoadError(model) },
    )
    return () => { active = false }
  }, [model, open, reloadCount, store])

  const ready = state !== null && model !== undefined
  const loaded = list !== undefined && list.model === model
  const loadFailed = loadError !== undefined && loadError === model

  return {
    selected: model === undefined ? EMPTY : state?.prefs.modelProviders[model] ?? EMPTY,
    providers: loaded ? list.data.providers : EMPTY,
    prices: loaded ? list.data.prices : undefined,
    unofficial: loaded ? list.data.unofficial : undefined,
    reasoning: loaded ? list.data.reasoning : undefined,
    status: loaded || loadFailed ? 'idle' : 'loading',
    error: saveError !== undefined && saveError === model ? 'save' : loadFailed ? 'load' : null,
    ready,
    saving,
    reload: () => { setReloadCount(count => count + 1) },
    save: async (providers: readonly string[]) => {
      if (model === undefined || savePending.current) return
      savePending.current = true
      setSaving(true)
      setSaveError(undefined)
      try {
        await store.saveModelProviders(model, providers)
      } catch {
        setSaveError(model)
      } finally {
        savePending.current = false
        setSaving(false)
      }
    },
  }
}
