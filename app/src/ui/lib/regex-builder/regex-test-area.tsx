import * as React from 'react'
import classNames from 'classnames'

interface IRegexTestAreaProps {
  /** The current regex source pattern. */
  readonly pattern: string
  /** The serialised flags string (e.g. `gi`). */
  readonly flags: string
  /** The current sample text (one candidate per line). */
  readonly sample: string
  readonly onSampleChanged: (sample: string) => void
}

interface IHighlightSegment {
  readonly text: string
  readonly matched: boolean
}

/** The maximum number of highlighted segments we're willing to render. */
const MaxHighlightSegments = 80

/**
 * The live tester at the bottom of the regex builder. Compiles the current
 * pattern, reports a match count, and renders the sample text with matched
 * runs highlighted.
 */
export class RegexTestArea extends React.Component<IRegexTestAreaProps> {
  private compile(global: boolean): RegExp | null {
    if (this.props.pattern.length === 0) {
      return null
    }

    // Ensure the global flag so we can walk every match, preserving the user's
    // other flags.
    const flags = new Set(this.props.flags.split(''))
    if (global) {
      flags.add('g')
    }
    flags.delete('y')

    try {
      return new RegExp(this.props.pattern, Array.from(flags).join(''))
    } catch {
      return null
    }
  }

  private isInvalid(): boolean {
    return this.props.pattern.length > 0 && this.compile(false) === null
  }

  private countMatches(): number {
    const regex = this.compile(true)
    if (regex === null) {
      return 0
    }

    let count = 0
    let guard = 0
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(this.props.sample)) !== null) {
      count++
      if (match[0].length === 0) {
        regex.lastIndex++
      }
      if (++guard > 5000) {
        break
      }
    }

    return count
  }

  private buildSegments(): ReadonlyArray<IHighlightSegment> {
    const regex = this.compile(true)
    const sample = this.props.sample

    if (regex === null) {
      return [{ text: sample, matched: false }]
    }

    const segments = new Array<IHighlightSegment>()
    let lastIndex = 0
    let guard = 0
    regex.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(sample)) !== null) {
      const start = match.index
      const end = start + match[0].length

      if (start > lastIndex) {
        segments.push({ text: sample.slice(lastIndex, start), matched: false })
      }

      if (match[0].length > 0) {
        segments.push({ text: sample.slice(start, end), matched: true })
        lastIndex = end
      } else {
        regex.lastIndex++
      }

      if (segments.length >= MaxHighlightSegments || ++guard > 5000) {
        break
      }
    }

    if (lastIndex < sample.length) {
      segments.push({ text: sample.slice(lastIndex), matched: false })
    }

    return segments
  }

  private renderCountChip() {
    const invalid = this.isInvalid()
    const count = invalid ? 0 : this.countMatches()

    const label = invalid
      ? 'invalid pattern'
      : `${count} ${count === 1 ? 'match' : 'matches'}`

    const className = classNames('regex-test-count', {
      invalid,
      matched: !invalid && count > 0,
      empty: !invalid && count === 0,
    })

    return <span className={className}>{label}</span>
  }

  private onSampleChanged = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    this.props.onSampleChanged(event.currentTarget.value)
  }

  public render() {
    const segments = this.buildSegments()

    return (
      <div className="regex-test-area">
        <div className="regex-test-header">
          <span className="regex-test-label">TEST</span>
          {this.renderCountChip()}
        </div>
        <textarea
          className="regex-test-sample"
          rows={2}
          spellCheck={false}
          value={this.props.sample}
          onChange={this.onSampleChanged}
        />
        <div className="regex-test-preview">
          {segments.map((segment, i) =>
            segment.matched ? (
              <mark key={i}>{segment.text}</mark>
            ) : (
              <span key={i}>{segment.text}</span>
            )
          )}
        </div>
      </div>
    )
  }
}
