// Сохраняем текст ошибок оплаты Пользы для истории чата и индикатора баланса.
export type BillingKind = 'balance' | 'key-limit'

export interface BillingAlert {
  kind: BillingKind
  message: string
  at: number
}

/** Это ошибка денег Пользы? Какая именно. */
export function classifyBilling(failure: { message: string; status?: number; code?: string }): BillingKind | undefined {
  const text = failure.message
  const paymentRequired = failure.status === 402 || failure.code === 'INSUFFICIENT_BALANCE' || /INSUFFICIENT_BALANCE/u.test(text)
  if (/лимит|limit balance|reservation exceeds/iu.test(text) && (paymentRequired || /Достигнут/u.test(text))) return 'key-limit'
  if (paymentRequired || /Недостаточно средств|Insufficient funds/iu.test(text)) return 'balance'
  return undefined
}
