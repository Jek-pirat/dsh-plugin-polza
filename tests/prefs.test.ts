import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { PrefsStore } from '../src/prefs.ts'

it('migrates a single saved provider and persists priority independently for each model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pz-prefs-'))
  try {
    const file = join(dir, 'settings.json')
    const model = 'anthropic/claude-sonnet-5.5'
    const other = 'openai/gpt-5.4-mini'
    await writeFile(file, JSON.stringify({ lowBalanceRub: 75, modelProviders: { [model]: 'anthropic' } }))
    const prefs = new PrefsStore(file)
    await prefs.load()
    expect(prefs.current().modelProviders[model]).toEqual(['anthropic'])

    await Promise.all([
      prefs.setModelProviders(model, ['google-vertex/europe', 'anthropic']),
      prefs.setModelProviders(other, ['azure']),
    ])
    const reloaded = new PrefsStore(file)
    await reloaded.load()
    expect(reloaded.current().modelProviders).toEqual({
      [model]: ['google-vertex/europe', 'anthropic'],
      [other]: ['azure'],
    })

    await reloaded.setModelProviders(model, [])
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      lowBalanceRub: 75, modelProviders: { [other]: ['azure'] },
    })
    expect(reloaded.current().modelProviders[model]).toBeUndefined()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
