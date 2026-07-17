import * as React from 'react'
import { Octicon, OcticonSymbol } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'

/** A single teaching section of the "How regex works" guide. */
export interface IRegexGuideSection {
  /** The leading symbol rendered beside the section title. */
  readonly icon: OcticonSymbol
  readonly title: string
  readonly body: string
  /** An optional highlighted example pattern. */
  readonly code?: string
  /** The muted explanation rendered after the example pattern. */
  readonly codeNote?: string
}

/**
 * The static "How regex works" guide content, mirroring the v2 prototype's
 * RB_GUIDE sections one to one. Octicons stand in for the prototype's
 * Material Symbols (school→mortarBoard, anchor→pin, category→apps,
 * repeat→iterations, join_inner→gitMerge, call_split→gitBranch,
 * visibility→eye, flag→flag, search→search).
 */
export const RegexGuideSections: ReadonlyArray<IRegexGuideSection> = [
  {
    icon: octicons.mortarBoard,
    title: 'How matching works',
    body:
      'A regular expression is a tiny program that scans text one character ' +
      'at a time, left to right. Each token in the pattern must match at the ' +
      'current position for the engine to advance; when a token fails, the ' +
      'engine backtracks and tries another interpretation. A search matches ' +
      'when the whole pattern can be satisfied somewhere in the text.',
    code: 'material',
    codeNote:
      '— plain characters match themselves; this finds "material" anywhere',
  },
  {
    icon: octicons.pin,
    title: 'Anchors pin the position',
    body:
      'Anchors match positions, not characters. ^ is the start of the text ' +
      '(or of each line with the m flag), $ is the end, \\b is the boundary ' +
      'between a word character and anything else, \\B is everywhere that is ' +
      'not a boundary.',
    code: '^app/.*\\.scss$',
    codeNote: '— paths that start with app/ and end in .scss',
  },
  {
    icon: octicons.apps,
    title: 'Character classes',
    body:
      'A class matches exactly one character from a set: \\d a digit, \\w a ' +
      'word character, \\s whitespace, and . any character at all. Square ' +
      'brackets build your own sets — [a-z] is a range, [^abc] means ' +
      'anything except a, b, or c.',
    code: '[0-9a-f]{7}',
    codeNote: '— exactly seven hex characters: a short commit sha',
  },
  {
    icon: octicons.iterations,
    title: 'Quantifiers and greediness',
    body:
      'Quantifiers repeat the token before them: * means zero or more, + one ' +
      'or more, ? optional, {n,m} between n and m times. They are greedy — ' +
      'they grab as much text as possible, then give back while ' +
      'backtracking. Append ? to make one lazy so it stops as early as it ' +
      'can.',
    code: '".*?"',
    codeNote:
      '— lazy: matches each quoted string separately instead of one giant match',
  },
  {
    icon: octicons.gitMerge,
    title: 'Groups and backreferences',
    body:
      'Parentheses capture what they matched so it can be reused: \\1 ' +
      're-matches the exact text of the first group. (?:…) groups without ' +
      'capturing, and (?<name>…) captures by name for \\k<name>.',
    code: '(\\w+)-\\1',
    codeNote: '— a word, a dash, then the same word again, like "tab-tab"',
  },
  {
    icon: octicons.gitBranch,
    title: 'Alternation',
    body:
      'The pipe | means or. Combine it with a group to keep it scoped: ' +
      'gr(a|e)y matches gray and grey. Without the group, the | splits the ' +
      'entire pattern in two.',
    code: '\\.(scss|tsx?)$',
    codeNote: '— files ending in .scss, .ts, or .tsx',
  },
  {
    icon: octicons.eye,
    title: 'Lookaround',
    body:
      'Lookarounds peek at what comes after (?=…) or before (?<=…) the ' +
      'current position without consuming it — the match position stays ' +
      'put. The negative forms (?!…) and (?<!…) assert that the text is NOT ' +
      'there.',
    code: 'ui/(?!lib)',
    codeNote: '— ui/ paths except the ones under ui/lib',
  },
  {
    icon: octicons.flag,
    title: 'Flags change the rules',
    body:
      'g finds every match instead of stopping at the first; i ignores ' +
      'case; m makes ^ and $ work per line; s lets . cross newlines; u ' +
      'switches on full Unicode semantics; y anchors each match to exactly ' +
      'where the previous one ended.',
  },
  {
    icon: octicons.search,
    title: 'How Desktop Material uses regex',
    body:
      'Every search bar in the app has a .* toggle that switches it from ' +
      'plain-text to regex matching. An invalid pattern outlines the field ' +
      'in red and filters nothing until fixed. This builder inserts tokens ' +
      'into the pattern, tests it live against sample text, and Apply fills ' +
      'the search bar that opened it — with regex mode switched on. The ' +
      'same guide ships with the project as docs/regex-guide.md for the ' +
      'wiki.',
  },
]

/** The stagger step between consecutive guide-section entrances. */
const StaggerStepMs = 50

/** The upper bound on any guide-section entrance delay. */
const MaxStaggerMs = 450

/**
 * The scrollable "How regex works" guide panel — the alternate view of the
 * regex builder toggled by the Build / How regex works segmented tabs.
 * Purely static teaching content extracted from the v2 prototype's rbGuide.
 */
export class RegexBuilderGuide extends React.Component {
  private renderSection(section: IRegexGuideSection, index: number) {
    const animationDelay = `${Math.min(index * StaggerStepMs, MaxStaggerMs)}ms`
    return (
      <section
        key={section.title}
        className="regex-guide-section"
        style={{ animationDelay }}
      >
        <h3>
          <Octicon className="regex-guide-icon" symbol={section.icon} />
          {section.title}
        </h3>
        <p>{section.body}</p>
        {section.code === undefined ? null : (
          <div className="regex-guide-code">
            <span className="regex-guide-code-token">{section.code}</span>
            <span className="regex-guide-code-note"> {section.codeNote}</span>
          </div>
        )}
      </section>
    )
  }

  public render() {
    return (
      <div
        id="regex-builder-view-guide"
        className="regex-builder-guide"
        role="tabpanel"
        aria-labelledby="regex-builder-view-tab-guide"
      >
        {RegexGuideSections.map((section, index) =>
          this.renderSection(section, index)
        )}
      </div>
    )
  }
}
