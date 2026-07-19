export type SupportedLocale = 'en' | 'zh-HK' | 'zh-CN'

export type TranslationKey =
  | 'ci.status'
  | 'ci.successful'
  | 'ci.failed'
  | 'ci.inProgress'
  | 'ci.timedOut'
  | 'ci.actionRequired'
  | 'ci.neutral'
  | 'ci.cancelled'
  | 'ci.skipped'
  | 'ci.stale'
  | 'update.downloadingLabel'
  | 'update.downloadingValue'
  | 'appearance.updateProgressColor'
  | 'appearance.useAccentColor'
  | 'color.blue'
  | 'color.violet'
  | 'color.teal'
  | 'color.green'
  | 'color.amber'
  | 'color.rose'

const english: Record<TranslationKey, string> = {
  'ci.status': 'CI checks: {status}',
  'ci.successful': 'successful',
  'ci.failed': 'failed',
  'ci.inProgress': 'in progress',
  'ci.timedOut': 'timed out',
  'ci.actionRequired': 'action required',
  'ci.neutral': 'neutral',
  'ci.cancelled': 'cancelled',
  'ci.skipped': 'skipped',
  'ci.stale': 'stale',
  'update.downloadingLabel': 'Downloading app update',
  'update.downloadingValue': 'Downloading',
  'appearance.updateProgressColor': 'Update progress color',
  'appearance.useAccentColor': 'Use accent color',
  'color.blue': 'Blue',
  'color.violet': 'Violet',
  'color.teal': 'Teal',
  'color.green': 'Green',
  'color.amber': 'Amber',
  'color.rose': 'Rose',
}

const catalogs: Record<SupportedLocale, Record<TranslationKey, string>> = {
  en: english,
  'zh-HK': {
    'ci.status': 'CI 檢查：{status}',
    'ci.successful': '成功',
    'ci.failed': '失敗',
    'ci.inProgress': '進行中',
    'ci.timedOut': '逾時',
    'ci.actionRequired': '需要處理',
    'ci.neutral': '中性',
    'ci.cancelled': '已取消',
    'ci.skipped': '已略過',
    'ci.stale': '已過期',
    'update.downloadingLabel': '正在下載應用程式更新',
    'update.downloadingValue': '正在下載',
    'appearance.updateProgressColor': '更新進度列顏色',
    'appearance.useAccentColor': '使用強調色',
    'color.blue': '藍色',
    'color.violet': '紫色',
    'color.teal': '藍綠色',
    'color.green': '綠色',
    'color.amber': '琥珀色',
    'color.rose': '玫瑰色',
  },
  'zh-CN': {
    'ci.status': 'CI 检查：{status}',
    'ci.successful': '成功',
    'ci.failed': '失败',
    'ci.inProgress': '进行中',
    'ci.timedOut': '超时',
    'ci.actionRequired': '需要处理',
    'ci.neutral': '中性',
    'ci.cancelled': '已取消',
    'ci.skipped': '已跳过',
    'ci.stale': '已过期',
    'update.downloadingLabel': '正在下载应用更新',
    'update.downloadingValue': '正在下载',
    'appearance.updateProgressColor': '更新进度条颜色',
    'appearance.useAccentColor': '使用强调色',
    'color.blue': '蓝色',
    'color.violet': '紫色',
    'color.teal': '蓝绿色',
    'color.green': '绿色',
    'color.amber': '琥珀色',
    'color.rose': '玫瑰色',
  },
}

export function normalizeLocale(locale: string | undefined): SupportedLocale {
  const normalized = locale?.replace('_', '-').toLowerCase()
  if (normalized === 'zh-hk' || normalized === 'zh-tw') {
    return 'zh-HK'
  }
  if (normalized?.startsWith('zh')) {
    return 'zh-CN'
  }
  return 'en'
}

export function translate(
  key: TranslationKey,
  locale: string | undefined,
  variables: Readonly<Record<string, string>> = {}
): string {
  const template = catalogs[normalizeLocale(locale)][key] ?? english[key]
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    return variables[name] ?? `{${name}}`
  })
}

export function t(
  key: TranslationKey,
  variables?: Readonly<Record<string, string>>
): string {
  const locale =
    typeof navigator === 'undefined' ? undefined : navigator.language
  return translate(key, locale, variables)
}
