import * as assert from 'assert'
import { describe, it } from 'node:test'
import { readdirSync, readFileSync, statSync } from 'fs'
import * as Path from 'path'
import {
  BulkActionSurfaceRegistry,
  SearchSurfaceRegistry,
} from '../../src/lib/collection-surface-registry'
import { FilterMode, matchWithMode } from '../../src/lib/fuzzy-find'

const uiRoot = Path.resolve(__dirname, '../../src/ui')

function tsxFiles(directory: string): ReadonlyArray<string> {
  return readdirSync(directory).flatMap(name => {
    const absolute = Path.join(directory, name)
    return statSync(absolute).isDirectory()
      ? tsxFiles(absolute)
      : name.endsWith('.tsx')
      ? [absolute]
      : []
  })
}

function source(relativePath: string): string {
  return readFileSync(Path.join(uiRoot, relativePath), 'utf8')
}

function jsxTags(contents: string, component: string): ReadonlyArray<string> {
  const escaped = component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    contents.match(
      new RegExp(`<${escaped}(?:<[^>\\r\\n]+>)?[\\s\\S]*?\\/>`, 'g')
    ) ?? []
  )
}

function literalAttribute(tag: string, attribute: string): string | null {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tag.match(new RegExp(`\\b${escaped}=(?:"([^"]+)"|'([^']+)')`))
  return match?.[1] ?? match?.[2] ?? null
}

function literalFilterListIds(contents: string): ReadonlyArray<string> {
  return [
    ...contents.matchAll(
      /\bfilterListId=(?:"([^"]+)"|'([^']+)'|\{[^\r\n]*?(?:'([^'\r\n]+)'|"([^"\r\n]+)")[^\r\n]*\})/g
    ),
  ].map(match => match[1] ?? match[2] ?? match[3] ?? match[4])
}

interface IMarkedTag {
  readonly id: string
  readonly source: string
  readonly tag: string
}

function markedTags(
  sources: ReadonlyMap<string, string>,
  component: string,
  attribute: string
): ReadonlyArray<IMarkedTag> {
  return [...sources].flatMap(([relativePath, contents]) =>
    jsxTags(contents, component).flatMap(tag => {
      const id = literalAttribute(tag, attribute)
      return id === null ? [] : [{ id, source: relativePath, tag }]
    })
  )
}

describe('collection surface registries', () => {
  it('binds every audited input one-to-one with its registry entry and regex builder', () => {
    const sources = new Map(
      tsxFiles(uiRoot).map(file => [
        Path.relative(uiRoot, file).replace(/\\/g, '/'),
        readFileSync(file, 'utf8'),
      ])
    )
    const standalone = SearchSurfaceRegistry.filter(
      surface => surface.implementation === 'standalone'
    )
    const shared = SearchSurfaceRegistry.filter(
      surface => surface.implementation === 'shared-filter-list'
    )
    const registryIds = SearchSurfaceRegistry.map(surface => surface.id)
    assert.strictEqual(
      new Set(registryIds).size,
      registryIds.length,
      'Search surface IDs must be unique'
    )

    const nativeInputs = markedTags(sources, 'input', 'data-search-surface-id')
    const textBoxes = markedTags(sources, 'TextBox', 'searchSurfaceId')
    const inputs = [...nativeInputs, ...textBoxes]
    const controls = markedTags(sources, 'FilterModeControl', 'searchSurfaceId')
    const directBuilders = markedTags(
      sources,
      'RegexBuilder',
      'searchSurfaceId'
    )
    const sharedMarkers = [...sources].flatMap(([relativePath, contents]) =>
      literalFilterListIds(contents).map(id => ({ id, source: relativePath }))
    )

    assert.deepStrictEqual(
      inputs.map(input => input.id).sort(),
      standalone.map(surface => surface.id).sort(),
      'Every standalone search input, including plain inputs, must have exactly one registered ID'
    )
    assert.deepStrictEqual(
      controls.map(control => control.id).sort(),
      standalone.map(surface => surface.id).sort(),
      'Every standalone search control must have exactly one registered ID'
    )
    assert.deepStrictEqual(
      sharedMarkers.map(marker => marker.id).sort(),
      shared.map(surface => surface.id).sort(),
      'Every shared filter-list control must have exactly one registered ID'
    )

    for (const surface of SearchSurfaceRegistry) {
      const contents = sources.get(surface.source)
      assert.ok(contents !== undefined, `Missing ${surface.source}`)
      if (surface.implementation === 'standalone') {
        assert.strictEqual(
          inputs.filter(
            input => input.source === surface.source && input.id === surface.id
          ).length,
          1,
          `${surface.label} must have one input marked ${surface.id}`
        )
        const matchingControls = controls.filter(
          control =>
            control.source === surface.source && control.id === surface.id
        )
        assert.strictEqual(
          matchingControls.length,
          1,
          `${surface.label} must have one FilterModeControl marked ${surface.id}`
        )
        const external = matchingControls[0].tag.includes(
          'showRegexBuilder={false}'
        )
        assert.strictEqual(
          directBuilders.filter(
            builder =>
              builder.source === surface.source && builder.id === surface.id
          ).length,
          external ? 1 : 0,
          external
            ? `${surface.label} must bind its external regex builder to ${surface.id}`
            : `${surface.label} must use its FilterModeControl regex builder`
        )
      } else {
        assert.strictEqual(
          literalFilterListIds(contents).filter(id => id === surface.id).length,
          1,
          `${surface.label} must have one shared filterListId ${surface.id}`
        )
      }
    }

    const externalControlIds = controls
      .filter(control => control.tag.includes('showRegexBuilder={false}'))
      .map(control => control.id)
      .sort()
    assert.deepStrictEqual(
      directBuilders.map(builder => builder.id).sort(),
      externalControlIds,
      'External builders must map one-to-one to controls that disable the inline builder'
    )

    for (const [relativePath, contents] of sources) {
      for (const component of ['input', 'TextBox']) {
        for (const tag of jsxTags(contents, component)) {
          if (/\btype=["']search["']/.test(tag)) {
            const marker = literalAttribute(
              tag,
              component === 'input'
                ? 'data-search-surface-id'
                : 'searchSurfaceId'
            )
            assert.ok(
              marker !== null,
              `Native search input in ${relativePath} needs a stable search surface ID`
            )
          }
        }
      }
    }

    const filterModeControl = source('lib/filter-mode-control.tsx')
    assert.match(
      filterModeControl,
      /<RegexBuilder\s+searchSurfaceId=\{this\.props\.searchSurfaceId\}/,
      'FilterModeControl must pass its exact surface ID to RegexBuilder'
    )
    for (const sharedControl of [
      'lib/section-filter-list.tsx',
      'lib/filter-list.tsx',
      'lib/augmented-filter-list.tsx',
    ]) {
      const contents = source(sharedControl)
      assert.match(
        contents,
        /<TextBox\s+searchSurfaceId=\{this\.props\.filterListId\}/,
        `${sharedControl} must mark its input with filterListId`
      )
      assert.match(
        contents,
        /<FilterModeControl\s+searchSurfaceId=\{this\.props\.filterListId\}/,
        `${sharedControl} must bind its regex builder to filterListId`
      )
    }
  })

  it('keeps invalid regex input non-throwing and preserves visible items', () => {
    const result = matchWithMode(
      '(',
      ['main', 'release/v2'],
      value => [value],
      {
        mode: FilterMode.Regex,
        caseSensitive: false,
      }
    )
    assert.deepStrictEqual(
      result.results.map(match => match.item),
      ['main', 'release/v2']
    )
    assert.ok(result.regexError)
  })

  it('records implemented bulk operations and explicit safety exclusions', () => {
    const ids = new Set<string>()
    for (const surface of BulkActionSurfaceRegistry) {
      assert.ok(!ids.has(surface.id), `Duplicate bulk surface ${surface.id}`)
      ids.add(surface.id)
      assert.ok(source(surface.source).length > 0)
      assert.ok(surface.safety.length > 20)
      assert.strictEqual(
        surface.operations.length > 0,
        surface.status === 'implemented',
        `${surface.label} must implement operations or be explicitly excluded`
      )
    }

    assert.match(
      source('github-releases/github-releases-view.tsx'),
      /Bulk release actions[\s\S]*Publish drafts[\s\S]*Delete selected/
    )
    assert.match(
      source('actions/actions-view.tsx'),
      /Bulk workflow run actions[\s\S]*Re-run completed[\s\S]*Cancel active/
    )
  })
})
