import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-plugin-manager'

const PACKAGE = '@polza-ai/dsh-plugin-polza'
const NPM = 'https://registry.npmjs.org/'

export type UpdateStatus = 'idle' | 'checking' | 'current' | 'unsupported' | 'updated' | 'restart-required' | 'error'

export async function updatePolza(
  manager: Pick<Context['pluginManager'], 'listBundles' | 'listVersions' | 'updateBundle'>,
  enabled: () => boolean,
  signal: AbortSignal,
): Promise<UpdateStatus> {
  if (signal.aborted || !enabled()) return 'idle'
  const installed = (await manager.listBundles()).find(bundle => bundle.name === PACKAGE)
  if (!installed?.enabled || !installed.updatable) return 'unsupported'
  if (signal.aborted || !enabled()) return 'idle'
  const versions = await manager.listVersions(PACKAGE, { registry: NPM }, signal)
  if (signal.aborted || !enabled()) return 'idle'
  if (versions.status === 'refused') return 'error'
  const next = versions.versions.find(version =>
    version.bundle && !version.prerelease && version.incompatible === undefined && version.deprecated === undefined)
  if (next === undefined) return 'current'
  // Delegate compatibility, package locking and rollback to the host.
  const { result } = await manager.updateBundle(PACKAGE, next.version, { registry: versions.registry })
  if (result.application === 'applied') return 'updated'
  if (result.application === 'restart-required') return 'restart-required'
  return 'error'
}
