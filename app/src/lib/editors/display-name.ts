import { getPersistedLanguageMode, translate } from '../i18n'
import { LanguageMode } from '../../models/language-mode'

const WslEditorMarker = ' — WSL: '

/** Localize a discovered editor label without changing its persisted value. */
export function getExternalEditorDisplayName(
  editor: string,
  languageMode: LanguageMode = getPersistedLanguageMode()
): string {
  const markerIndex = editor.lastIndexOf(WslEditorMarker)
  if (markerIndex <= 0) {
    return editor
  }

  const distribution = editor.slice(markerIndex + WslEditorMarker.length)
  if (distribution.length === 0) {
    return editor
  }

  return translate('editor.wslDisplayName', languageMode, {
    editor: editor.slice(0, markerIndex),
    distribution,
  })
}
