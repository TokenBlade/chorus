import { ts, type Lang } from '../i18n/translations'

export function getProviderLabel(provider: string, lang: Lang): string {
  const key = `provider.${provider}` as Parameters<typeof ts>[1]
  return ts(lang, key) || provider
}
