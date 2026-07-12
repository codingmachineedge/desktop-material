import * as React from 'react'

/** A single insertable token in the regex builder palette. */
export interface IRegexToken {
  /** The literal text appended to the pattern when the chip is clicked. */
  readonly token: string
  /** A short human readable description shown under the token. */
  readonly description: string
}

/** A named group of related tokens. */
export interface IRegexCategory {
  readonly name: string
  readonly tokens: ReadonlyArray<IRegexToken>
}

/**
 * The grouped palette shown down the left of the regex builder. Mirrors the
 * design's RB_CATS taxonomy.
 */
export const RegexCategories: ReadonlyArray<IRegexCategory> = [
  {
    name: 'Anchors',
    tokens: [
      { token: '^', description: 'start of line' },
      { token: '$', description: 'end of line' },
      { token: '\\b', description: 'word boundary' },
      { token: '\\B', description: 'non-boundary' },
    ],
  },
  {
    name: 'Character classes',
    tokens: [
      { token: '.', description: 'any character' },
      { token: '\\d', description: 'digit' },
      { token: '\\D', description: 'non-digit' },
      { token: '\\w', description: 'word char' },
      { token: '\\W', description: 'non-word char' },
      { token: '\\s', description: 'whitespace' },
      { token: '\\S', description: 'non-whitespace' },
      { token: '[abc]', description: 'any of a, b, c' },
      { token: '[^abc]', description: 'none of a, b, c' },
      { token: '[a-z]', description: 'a range' },
      { token: '\\t', description: 'tab' },
      { token: '\\n', description: 'newline' },
    ],
  },
  {
    name: 'Quantifiers',
    tokens: [
      { token: '*', description: 'zero or more' },
      { token: '+', description: 'one or more' },
      { token: '?', description: 'optional' },
      { token: '{3}', description: 'exactly 3' },
      { token: '{2,}', description: '2 or more' },
      { token: '{2,5}', description: 'between 2 and 5' },
      { token: '*?', description: 'lazy zero or more' },
      { token: '+?', description: 'lazy one or more' },
    ],
  },
  {
    name: 'Groups & refs',
    tokens: [
      { token: '()', description: 'capturing group' },
      { token: '(?:)', description: 'non-capturing group' },
      { token: '(?<name>)', description: 'named group' },
      { token: '\\1', description: 'back-reference' },
      { token: '\\k<name>', description: 'named reference' },
    ],
  },
  {
    name: 'Alternation',
    tokens: [
      { token: '|', description: 'or' },
      { token: '(a|b)', description: 'a or b' },
    ],
  },
  {
    name: 'Lookaround',
    tokens: [
      { token: '(?=)', description: 'lookahead' },
      { token: '(?!)', description: 'negative lookahead' },
      { token: '(?<=)', description: 'lookbehind' },
      { token: '(?<!)', description: 'negative lookbehind' },
    ],
  },
]

interface IRegexBuilderPaletteProps {
  readonly categories: ReadonlyArray<IRegexCategory>
  readonly activeCategory: number
  readonly onCategoryChange: (index: number) => void
  readonly onInsertToken: (token: string) => void
}

/**
 * The two-column palette body of the regex builder: a category rail on the left
 * and the grid of insertable token chips for the active category on the right.
 */
interface IRegexCategoryTabProps {
  readonly name: string
  readonly index: number
  readonly selected: boolean
  readonly onCategoryChange: (index: number) => void
}

class RegexCategoryTab extends React.Component<IRegexCategoryTabProps> {
  private onClick = () => {
    this.props.onCategoryChange(this.props.index)
  }

  public render() {
    const { name, selected } = this.props
    return (
      <button
        role="tab"
        aria-selected={selected}
        className={
          selected
            ? 'regex-builder-category selected'
            : 'regex-builder-category'
        }
        onClick={this.onClick}
      >
        {name}
      </button>
    )
  }
}

interface IRegexTokenChipProps {
  readonly token: IRegexToken
  readonly onInsertToken: (token: string) => void
}

class RegexTokenChip extends React.Component<IRegexTokenChipProps> {
  private onClick = () => {
    this.props.onInsertToken(this.props.token.token)
  }

  public render() {
    const { token, description } = this.props.token
    return (
      <button
        className="regex-builder-token"
        aria-label={description}
        onClick={this.onClick}
      >
        <span className="regex-builder-token-glyph">{token}</span>
        <span className="regex-builder-token-desc">{description}</span>
      </button>
    )
  }
}

export class RegexBuilderPalette extends React.Component<IRegexBuilderPaletteProps> {
  public render() {
    const { categories, activeCategory } = this.props
    const active = categories[activeCategory] ?? categories[0]

    return (
      <div className="regex-builder-palette">
        <div className="regex-builder-categories" role="tablist">
          {categories.map((category, index) => (
            <RegexCategoryTab
              key={category.name}
              name={category.name}
              index={index}
              selected={index === activeCategory}
              onCategoryChange={this.props.onCategoryChange}
            />
          ))}
        </div>
        <div className="regex-builder-tokens">
          {active.tokens.map(t => (
            <RegexTokenChip
              key={t.token}
              token={t}
              onInsertToken={this.props.onInsertToken}
            />
          ))}
        </div>
      </div>
    )
  }
}
