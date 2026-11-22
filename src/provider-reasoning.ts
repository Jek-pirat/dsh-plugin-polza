import { REASONING_LEVELS } from './reasoning.ts'
import type { ReasoningLevel } from './reasoning.ts'

/** Auto may use any compatible provider. Explicit fallbacks must all support the level. */
export function providerReasoningLevels(
  entries: ReadonlyMap<string, readonly ReasoningLevel[]>,
  selected: readonly string[] = [],
): ReasoningLevel[] {
  const routes = selected.length === 0 ? [...entries.values()] : selected.map(name => entries.get(name) ?? [])
  return REASONING_LEVELS.filter(level => selected.length === 0
    ? routes.some(efforts => efforts.includes(level))
    : routes.every(efforts => efforts.includes(level)))
}
