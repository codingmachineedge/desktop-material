/**
 * Compose a friendly, localized display name for a derived repository theme.
 *
 * The pure {@link IRepositoryTheme} only carries structural descriptors (mood,
 * texture, scale, root note). This module maps those onto translation keys so
 * the name reads naturally in English, Cantonese, or bilingual mode without the
 * derivation logic ever depending on i18n.
 */

import { LanguageMode } from '../../models/language-mode'
import { translate, translatedVariable, TranslationKey } from '../i18n'
import {
  IRepositoryTheme,
  RepositoryThemeMood,
  RepositoryThemeScaleId,
  RepositoryThemeTexture,
  repositoryThemeRootLabel,
} from './repo-theme'

const MoodKeys: Readonly<Record<RepositoryThemeMood, TranslationKey>> = {
  calm: 'settings.repoThemeMoodCalm',
  bright: 'settings.repoThemeMoodBright',
  driving: 'settings.repoThemeMoodDriving',
  dreamy: 'settings.repoThemeMoodDreamy',
  mellow: 'settings.repoThemeMoodMellow',
  playful: 'settings.repoThemeMoodPlayful',
  solemn: 'settings.repoThemeMoodSolemn',
  electric: 'settings.repoThemeMoodElectric',
}

const TextureKeys: Readonly<Record<RepositoryThemeTexture, TranslationKey>> = {
  pulse: 'settings.repoThemeTexturePulse',
  cascade: 'settings.repoThemeTextureCascade',
  drift: 'settings.repoThemeTextureDrift',
  bloom: 'settings.repoThemeTextureBloom',
  circuit: 'settings.repoThemeTextureCircuit',
  horizon: 'settings.repoThemeTextureHorizon',
  lantern: 'settings.repoThemeTextureLantern',
  tide: 'settings.repoThemeTextureTide',
}

const ScaleKeys: Readonly<Record<RepositoryThemeScaleId, TranslationKey>> = {
  major: 'settings.repoThemeScaleMajor',
  minor: 'settings.repoThemeScaleMinor',
  dorian: 'settings.repoThemeScaleDorian',
  mixolydian: 'settings.repoThemeScaleMixolydian',
  lydian: 'settings.repoThemeScaleLydian',
  pentatonic: 'settings.repoThemeScalePentatonic',
}

/** Build the localized display name for a repository theme. */
export function repositoryThemeName(
  theme: IRepositoryTheme,
  languageMode: LanguageMode
): string {
  return translate('settings.repoThemeNameFormat', languageMode, {
    mood: translatedVariable(MoodKeys[theme.mood]),
    texture: translatedVariable(TextureKeys[theme.texture]),
    root: repositoryThemeRootLabel(theme),
    scale: translatedVariable(ScaleKeys[theme.scaleId]),
  })
}
