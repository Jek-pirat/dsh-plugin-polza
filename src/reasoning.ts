export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningLevel = typeof REASONING_LEVELS[number]

export function declaredReasoningLevels(efforts: readonly string[], mandatory: boolean): ReasoningLevel[] {
  const values = new Set(efforts.map(effort => effort.trim().toLowerCase()))
  return REASONING_LEVELS.filter(level => level === 'off' ? !mandatory && values.has('none') : values.has(level))
}
