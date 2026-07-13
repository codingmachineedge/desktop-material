import { getBoolean, setBoolean } from '../../../lib/local-storage'

const SvgDiffShowCodeKey = 'svg-diff-show-code'

export function getSvgDiffShowCode(): boolean {
  return getBoolean(SvgDiffShowCodeKey, true)
}

export function saveSvgDiffShowCode(showCode: boolean): void {
  setBoolean(SvgDiffShowCodeKey, showCode)
}
