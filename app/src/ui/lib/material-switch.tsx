import * as React from 'react'
import classNames from 'classnames'
import { MaterialSymbol } from './material-symbol'
import { createUniqueId, releaseUniqueId } from './id-pool'

interface IMaterialSwitchProps {
  /** Whether the switch is currently on. */
  readonly checked: boolean

  /** Called with the requested next value when the user toggles the switch. */
  readonly onChange: (checked: boolean) => void

  /** Disables interaction and dims the control. */
  readonly disabled?: boolean

  /**
   * Optional visible label rendered before the switch. When provided it is
   * associated with the control automatically. Prefer `ariaLabelledBy` when the
   * visible label already lives in a surrounding row (as in the settings cards).
   */
  readonly label?: string | JSX.Element

  /** Accessible name when no visible label is associated with the control. */
  readonly ariaLabel?: string

  /** Id of an element that labels the control (e.g. a card title). */
  readonly ariaLabelledBy?: string

  /** Id of an element that further describes the control. */
  readonly ariaDescribedBy?: string

  /** Tab index forwarded to the underlying button. */
  readonly tabIndex?: number

  readonly className?: string
}

interface IMaterialSwitchState {
  /** Generated id linking a rendered `label` to the control. */
  readonly labelId?: string
}

/**
 * A Material Design 3 switch.
 *
 * Renders as a `role="switch"` button with a pill track and a sliding thumb
 * that carries an embedded check glyph, matching the Desktop Material v2 design
 * (~54x32 track, primary/outline tokens, spring motion). The thumb spring is
 * suppressed under `prefers-reduced-motion` by the SCSS partner file.
 *
 * The accessible name comes from `label`, `ariaLabel`, or `ariaLabelledBy`; one
 * of them must be supplied so assistive technology can announce the control.
 */
export class MaterialSwitch extends React.Component<
  IMaterialSwitchProps,
  IMaterialSwitchState
> {
  public constructor(props: IMaterialSwitchProps) {
    super(props)
    this.state = {}
  }

  public componentDidMount() {
    if (this.props.label !== undefined) {
      this.setState({ labelId: createUniqueId('MaterialSwitch') })
    }
  }

  public componentWillUnmount() {
    if (this.state.labelId !== undefined) {
      releaseUniqueId(this.state.labelId)
    }
  }

  private onClick = () => {
    if (this.props.disabled === true) {
      return
    }
    this.props.onChange(!this.props.checked)
  }

  private renderButton(labelledBy: string | undefined) {
    const { checked, disabled, ariaLabel, ariaDescribedBy, tabIndex } =
      this.props

    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        tabIndex={tabIndex}
        className="material-switch"
        onClick={this.onClick}
      >
        <span className="material-switch-thumb">
          <MaterialSymbol
            name="check"
            className="material-switch-check"
            size={14}
            weight={600}
          />
        </span>
      </button>
    )
  }

  public render() {
    const { label, ariaLabelledBy, className } = this.props

    // An explicit ariaLabelledBy always wins; otherwise a rendered visible
    // label supplies the accessible name.
    const labelledBy =
      ariaLabelledBy ?? (label !== undefined ? this.state.labelId : undefined)

    if (label === undefined) {
      return (
        <span className={classNames('material-switch-component', className)}>
          {this.renderButton(labelledBy)}
        </span>
      )
    }

    return (
      <span
        className={classNames(
          'material-switch-component',
          'material-switch-labelled',
          className
        )}
      >
        <span className="material-switch-label" id={this.state.labelId}>
          {label}
        </span>
        {this.renderButton(labelledBy)}
      </span>
    )
  }
}
