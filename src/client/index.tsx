// Браузерная половина dsh-plugin-polza: раздел «Польза» в настройках, баланс в
// сайдбаре, карточка на странице Models и иконки провайдеров у моделей Polza в пикере.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { PolzaStore } from './api.ts'
import { injectCss, pickerIconsCss, PolzaMark } from './brand.tsx'
import { BalanceChip, ModelsFooterCard } from './Chip.tsx'
import { DICTIONARIES, NS } from './locale.ts'
import type { T } from './locale.ts'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ModelSelect } from './model-picker/ModelSelect.tsx'
import { PolzaSection } from './Section.tsx'
import { SpendPill } from './Spend.tsx'
import { MediaToolView } from './Notices.tsx'
import { IMAGE_TOOL, VIDEO_TOOL } from '../tool-names.ts'

export const name = 'polza-ui'
export const inject = ['slots', 'locale']

const PACKAGE = '@polza-ai/dsh-plugin-polza'

export function apply(ctx: Context): void {
  // Типы слотов harness строгие и закрытые; здесь регистрируем через узкий интерфейс.
  const slots = ctx.slots as unknown as {
    inject: (name: string, fn: () => (() => void) | Iterable<() => void>) => () => void
    register: (options: Record<string, unknown>, component: (props: never) => unknown) => () => void
  }
  const locale = ctx.locale as unknown as {
    register: (ns: string, dicts: Record<string, Record<string, string>>) => () => void
    bind: (ns: string) => T
  }
  ctx.effect(() => locale.register(NS, DICTIONARIES), 'polza: dictionaries')
  ctx.effect(() => injectCss(PACKAGE), 'polza: styles')
  const t = locale.bind(NS)

  const store = new PolzaStore()
  ctx.effect(() => store.start(), 'polza: account store')

  // Иконки провайдеров в пикере: пересобираем стиль, когда меняется белый список.
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset['plugin'] = PACKAGE
    tag.dataset['pluginCss'] = `${PACKAGE}/picker-icons.css`
    document.head.appendChild(tag)
    let shown = ''
    const sync = () => {
      const models = store.getSnapshot().state?.models.join('\n')
      if (models === undefined || models === shown) return
      shown = models
      store.pickerIcons().then((icons) => { tag.textContent = pickerIconsCss(icons) }, () => { shown = '' })
    }
    const unsubscribe = store.subscribe(sync)
    sync()
    return () => { unsubscribe(); tag.remove() }
  }, 'polza: picker icons')

  slots.inject('settings.section', () => slots.register({
    name: 'settings.section', id: 'polza', order: 5, label: () => t('nav'), locale: NS,
    inject: () => ({ store }),
  }, PolzaSection as never))

  slots.inject('settings.section.icon', () => slots.register({
    name: 'settings.section.icon', id: 'polza',
  }, (({ size }: { size: number }) => <PolzaMark size={size} />) as never))

  slots.inject('sidebar.footer.action', () => slots.register({
    name: 'sidebar.footer.action', id: 'polza-balance', locale: NS,
    inject: () => ({ store }),
  }, BalanceChip as never))

  // The stock picker seat owns its label slot exclusively. Reuse the stock
  // directory and locale with our higher-priority composer picker.
  ctx.inject(['modelDirectories', 'sessions'], scope => {
    const directories = scope.modelDirectories
    const sessions = scope.sessions
    slots.inject('conversation.input.model', () => slots.register({
      name: 'conversation.input.model', priority: -1, locale: 'model',
      inject: (sessionId: Parameters<typeof directories.directoryFor>[0]) => {
        const directory = directories.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          load: () => { if (available) void directory.load().catch(() => {}) },
          select: (selection: Parameters<typeof directory.select>[0]) =>
            available ? directory.select(selection) : Promise.resolve(undefined),
          resolveText: (label: Parameters<typeof scope.locale.resolveText>[0]) => scope.locale.resolveText(label),
          store,
          providerT: t,
        }
      },
    }, ModelSelect as never))
  })

  slots.inject('conversation.composer.dock', () => slots.register({
    name: 'conversation.composer.dock', id: 'polza-spend', order: 5, locale: NS,
    inject: (sessionId?: string) => ({ store, sessionId }),
  }, SpendPill as never))

  for (const key of [IMAGE_TOOL, VIDEO_TOOL]) {
    slots.inject('tool.call.toolview', () => slots.register({
      name: 'tool.call.toolview', key, locale: NS,
    }, MediaToolView as never))
  }

  slots.inject('settings.models.footer', () => slots.register({
    name: 'settings.models.footer', id: 'polza', locale: NS,
    inject: () => ({ store }),
  }, ModelsFooterCard as never))
}
