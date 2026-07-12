import * as octicons from '../../ui/octicons/octicons.generated'
import { gitIgnoreTemplateBodies } from './catalog.generated'

/** Broad grouping used to organize the browse view of the catalog. */
export type GitIgnoreCategory =
  | 'language'
  | 'framework'
  | 'editor'
  | 'os'
  | 'build'

/**
 * Heuristic fingerprints used by the suggestion engine to decide whether a
 * template is likely relevant to a given repository. All entries are matched
 * against repo-relative paths (forward-slash separated).
 */
export interface IGitIgnoreMarkers {
  /** Exact repo-relative files, e.g. `package.json`, `Cargo.toml`. */
  readonly files?: ReadonlyArray<string>
  /** Glob patterns matched against sampled files, e.g. `*.sln`, `*.tf`. */
  readonly globs?: ReadonlyArray<string>
  /** Exact repo-relative directories, e.g. `.idea`, `Assets`. */
  readonly dirs?: ReadonlyArray<string>
  /** File extensions sampled across the tree, e.g. `.py`, `.rs`, `.go`. */
  readonly extensions?: ReadonlyArray<string>
}

/** A single ignore template with metadata and its (generated) body. */
export interface IGitIgnoreTemplate {
  readonly id: string
  readonly label: string
  readonly category: GitIgnoreCategory
  readonly octicon: keyof typeof octicons
  readonly markers?: IGitIgnoreMarkers
  /** When set, the template is suggested on a matching host platform. */
  readonly platform?: NodeJS.Platform
  /** The raw template body (LF-only), sourced from github/gitignore. */
  readonly body: string
}

/** Hand-authored metadata; bodies are merged in from `catalog.generated.ts`. */
type IGitIgnoreTemplateMeta = Omit<IGitIgnoreTemplate, 'body'>

const templateMeta: ReadonlyArray<IGitIgnoreTemplateMeta> = [
  {
    id: 'node',
    label: 'Node',
    category: 'language',
    octicon: 'server',
    markers: {
      files: ['package.json'],
      dirs: ['node_modules'],
    },
  },
  {
    id: 'python',
    label: 'Python',
    category: 'language',
    octicon: 'code',
    markers: {
      files: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'],
      extensions: ['.py'],
    },
  },
  {
    id: 'rust',
    label: 'Rust',
    category: 'language',
    octicon: 'gear',
    markers: {
      files: ['Cargo.toml'],
      extensions: ['.rs'],
    },
  },
  {
    id: 'go',
    label: 'Go',
    category: 'language',
    octicon: 'codeSquare',
    markers: {
      files: ['go.mod', 'go.sum'],
      extensions: ['.go'],
    },
  },
  {
    id: 'java',
    label: 'Java',
    category: 'language',
    octicon: 'cpu',
    markers: {
      files: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'],
      extensions: ['.java'],
    },
  },
  {
    id: 'visualstudio',
    label: 'Visual Studio',
    category: 'editor',
    octicon: 'deviceDesktop',
    markers: {
      globs: ['*.sln', '*.csproj', '*.vbproj'],
    },
  },
  {
    id: 'jetbrains',
    label: 'JetBrains',
    category: 'editor',
    octicon: 'tools',
    markers: {
      dirs: ['.idea'],
      globs: ['*.iml'],
    },
  },
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    category: 'editor',
    octicon: 'codescan',
    markers: {
      dirs: ['.vscode'],
    },
  },
  {
    id: 'macos',
    label: 'macOS',
    category: 'os',
    octicon: 'deviceDesktop',
    platform: 'darwin',
    markers: {
      files: ['.DS_Store'],
    },
  },
  {
    id: 'windows',
    label: 'Windows',
    category: 'os',
    octicon: 'browser',
    platform: 'win32',
    markers: {
      files: ['Thumbs.db', 'desktop.ini'],
    },
  },
  {
    id: 'linux',
    label: 'Linux',
    category: 'os',
    octicon: 'terminal',
    platform: 'linux',
  },
  {
    id: 'unity',
    label: 'Unity',
    category: 'framework',
    octicon: 'rocket',
    markers: {
      dirs: ['Assets', 'ProjectSettings'],
      globs: ['*.unity'],
    },
  },
  {
    id: 'unrealengine',
    label: 'Unreal Engine',
    category: 'framework',
    octicon: 'flame',
    markers: {
      globs: ['*.uproject'],
      dirs: ['Intermediate'],
    },
  },
  {
    id: 'terraform',
    label: 'Terraform',
    category: 'build',
    octicon: 'container',
    markers: {
      globs: ['*.tf'],
      dirs: ['.terraform'],
    },
  },
  {
    id: 'jekyll',
    label: 'Jekyll',
    category: 'framework',
    octicon: 'globe',
    markers: {
      files: ['_config.yml'],
      dirs: ['_site', '_posts'],
    },
  },
  {
    id: 'ruby',
    label: 'Ruby',
    category: 'language',
    octicon: 'ruby',
    markers: {
      files: ['Gemfile', 'Rakefile', '.ruby-version'],
      extensions: ['.rb'],
    },
  },
  {
    id: 'composer',
    label: 'Composer',
    category: 'language',
    octicon: 'stack',
    markers: {
      files: ['composer.json'],
      extensions: ['.php'],
    },
  },
  {
    id: 'dart',
    label: 'Dart',
    category: 'language',
    octicon: 'codeSquare',
    markers: {
      files: ['pubspec.yaml'],
      extensions: ['.dart'],
    },
  },
  {
    id: 'flutter',
    label: 'Flutter',
    category: 'framework',
    octicon: 'paintbrush',
    markers: {
      files: ['pubspec.yaml'],
      dirs: ['.dart_tool'],
    },
  },
]

const catalog: ReadonlyArray<IGitIgnoreTemplate> = templateMeta.map(meta => ({
  ...meta,
  body: gitIgnoreTemplateBodies[meta.id] ?? '',
}))

const catalogById = new Map<string, IGitIgnoreTemplate>(
  catalog.map(template => [template.id, template])
)

/** All curated ignore templates, in a stable authored order. */
export function getTemplateCatalog(): ReadonlyArray<IGitIgnoreTemplate> {
  return catalog
}

/** Look up a single template by its stable id. */
export function getTemplateById(id: string): IGitIgnoreTemplate | undefined {
  return catalogById.get(id)
}
