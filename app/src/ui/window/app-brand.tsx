import * as React from 'react'
import classNames from 'classnames'
import { encodePathAsUrl } from '../../lib/path'
import {
  appBrandStyleToCss,
  appLogoStyleToCss,
  appNameStyleToCss,
  getAppLogoInitial,
  IAppIdentityCustomization,
} from '../../models/app-identity'
import { MaterialSymbol, MaterialSymbolName } from '../lib/material-symbol'

interface IAppBrandProps {
  readonly identity: IAppIdentityCustomization
  readonly className?: string
  readonly preview?: boolean
}

/**
 * The fork's Material identity mark for each logo choice. The default
 * ('github'), monogram fallback and custom-image fallback all resolve to the
 * neutral Material app glyph rather than the legacy GitHub Octocat.
 */
function getLogoSymbolName(
  identity: IAppIdentityCustomization
): MaterialSymbolName {
  switch (identity.logo) {
    case 'repository':
      return 'book_2'
    case 'terminal':
      return 'terminal'
    case 'code':
      return 'code'
    case 'sparkle':
      return 'auto_awesome'
    case 'github':
    case 'monogram':
    case 'custom':
      return 'deployed_code'
  }
}

/** The shared live brand used by both the Windows title bar and its preview. */
export class AppBrand extends React.Component<IAppBrandProps> {
  private onCustomLogoError = (
    event: React.SyntheticEvent<HTMLImageElement>
  ) => {
    event.currentTarget.hidden = true
  }

  public render() {
    const { identity } = this.props
    const showMonogram = identity.logo === 'monogram'
    const customLogoPath =
      identity.logo === 'custom' ? identity.customLogoPath : null

    // Fit the glyph inside the profile-sized tile (tile size minus its inset on
    // each edge). MaterialSymbol clamps this to its supported range.
    const logoSize =
      typeof identity.logoSize === 'number' ? identity.logoSize : 21
    const logoInset =
      typeof identity.logoInset === 'number' ? identity.logoInset : 3
    const glyphSize = Math.max(12, Math.round(logoSize - logoInset * 2))

    return (
      <span
        className={classNames('app-brand-container', this.props.className, {
          'app-brand-preview': this.props.preview,
        })}
        style={appBrandStyleToCss(identity)}
        data-customization-surface="app-identity"
        data-customization-label="App identity"
        data-customization-scope="profile"
      >
        {identity.showLogo && (
          <span
            className="app-brand-logo"
            style={appLogoStyleToCss(identity)}
            aria-hidden={true}
          >
            {showMonogram ? (
              <span className="app-brand-monogram">
                {getAppLogoInitial(identity.displayName)}
              </span>
            ) : (
              <MaterialSymbol
                className="app-icon"
                name={getLogoSymbolName(identity)}
                size={glyphSize}
              />
            )}
            {customLogoPath !== null && (
              <img
                key={customLogoPath}
                className="app-brand-custom-logo"
                src={encodePathAsUrl(customLogoPath)}
                alt=""
                onError={this.onCustomLogoError}
              />
            )}
          </span>
        )}
        <span className="app-brand" style={appNameStyleToCss(identity)}>
          {identity.displayName}
        </span>
      </span>
    )
  }
}
