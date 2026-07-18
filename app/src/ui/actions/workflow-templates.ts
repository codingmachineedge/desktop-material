import { OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/** Category badge shown on a workflow template card. */
export type WorkflowTemplateCategory =
  | 'CI'
  | 'Deploy'
  | 'Security'
  | 'Automation'
  | 'Release'

/** A curated GitHub starter workflow offered by the catalog dialog. */
export interface IWorkflowTemplate {
  readonly id: string
  /** Display name, e.g. "Node.js CI". */
  readonly name: string
  /** Workflow file basename, e.g. "node-ci.yml". */
  readonly file: string
  /** Repository-relative path, e.g. ".github/workflows/node-ci.yml". */
  readonly path: string
  readonly category: WorkflowTemplateCategory
  /** Human summary of the trigger, e.g. "push · pull_request". */
  readonly trigger: string
  readonly description: string
  readonly icon: OcticonSymbol
  /** Complete YAML written into the repository when the template is used. */
  readonly yaml: string
}

export const WorkflowTemplateCategories: ReadonlyArray<WorkflowTemplateCategory> =
  ['CI', 'Deploy', 'Security', 'Automation', 'Release']

const workflowsDirectory = '.github/workflows'

const template = (
  entry: Omit<IWorkflowTemplate, 'path'>
): IWorkflowTemplate => ({
  ...entry,
  path: `${workflowsDirectory}/${entry.file}`,
})

/**
 * Static catalog of GitHub starter workflows. The YAML mirrors the shape of
 * github/starter-workflows templates while staying small enough to review in
 * a diff before committing.
 */
export const WorkflowTemplates: ReadonlyArray<IWorkflowTemplate> = [
  template({
    id: 'node-ci',
    name: 'Node.js CI',
    file: 'node-ci.yml',
    category: 'CI',
    trigger: 'push · pull_request',
    description:
      'Install dependencies with npm and run the build and test scripts across a Node.js version matrix.',
    icon: octicons.beaker,
    yaml: `name: Node.js CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js \${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run build --if-present
      - run: npm test
`,
  }),
  template({
    id: 'docker-publish',
    name: 'Docker publish',
    file: 'docker-publish.yml',
    category: 'Deploy',
    trigger: 'push tag',
    description:
      'Build the Docker image and publish it to GitHub Container Registry whenever a version tag is pushed.',
    icon: octicons.container,
    yaml: `name: Docker publish

on:
  push:
    tags: ['v*.*.*']

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: \${{ github.repository }}

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - name: Log in to the container registry
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}:\${{ github.ref_name }}
`,
  }),
  template({
    id: 'deploy-pages',
    name: 'Deploy GitHub Pages',
    file: 'pages.yml',
    category: 'Deploy',
    trigger: 'push main',
    description:
      'Upload the static site artifact and deploy it to GitHub Pages from the default branch.',
    icon: octicons.globe,
    yaml: `name: Deploy GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - id: deployment
        uses: actions/deploy-pages@v4
`,
  }),
  template({
    id: 'codeql',
    name: 'CodeQL analysis',
    file: 'codeql.yml',
    category: 'Security',
    trigger: 'push · schedule',
    description:
      'Scan the default branch and pull requests for vulnerabilities with GitHub CodeQL on a weekly cadence.',
    icon: octicons.codescan,
    yaml: `name: CodeQL analysis

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '30 5 * * 1'

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript
      - uses: github/codeql-action/analyze@v3
`,
  }),
  template({
    id: 'dependency-review',
    name: 'Dependency review',
    file: 'dependency-review.yml',
    category: 'Security',
    trigger: 'pull_request',
    description:
      'Block pull requests that introduce dependencies with known vulnerabilities or disallowed licenses.',
    icon: octicons.shieldCheck,
    yaml: `name: Dependency review

on: [pull_request]

permissions:
  contents: read

jobs:
  dependency-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high
`,
  }),
  template({
    id: 'stale',
    name: 'Close stale issues',
    file: 'stale.yml',
    category: 'Automation',
    trigger: 'schedule',
    description:
      'Label issues and pull requests without recent activity as stale and close them after a grace period.',
    icon: octicons.hourglass,
    yaml: `name: Close stale issues

on:
  schedule:
    - cron: '30 1 * * *'

permissions:
  issues: write
  pull-requests: write

jobs:
  stale:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/stale@v9
        with:
          days-before-issue-stale: 60
          days-before-issue-close: 14
          stale-issue-label: stale
          stale-pr-label: stale
`,
  }),
  template({
    id: 'release',
    name: 'Release on tag',
    file: 'release.yml',
    category: 'Release',
    trigger: 'push tag',
    description:
      'Draft a GitHub release with generated notes whenever a semver tag lands on the repository.',
    icon: octicons.tag,
    yaml: `name: Release on tag

on:
  push:
    tags: ['v*.*.*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Create release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
`,
  }),
  template({
    id: 'lint',
    name: 'Lint',
    file: 'lint.yml',
    category: 'CI',
    trigger: 'pull_request',
    description:
      'Run the Super-Linter suite against changed files so style feedback lands on every pull request.',
    icon: octicons.checklist,
    yaml: `name: Lint

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  statuses: write

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: super-linter/super-linter@v7
        env:
          DEFAULT_BRANCH: main
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`,
  }),
  template({
    id: 'tests',
    name: 'Tests',
    file: 'test.yml',
    category: 'CI',
    trigger: 'push · pull_request',
    description:
      'Run the unit test suite on Linux, macOS, and Windows runners so regressions surface on every push.',
    icon: octicons.meter,
    yaml: `name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
`,
  }),
  template({
    id: 'manual',
    name: 'Manual workflow',
    file: 'manual.yml',
    category: 'Automation',
    trigger: 'workflow_dispatch',
    description:
      'A workflow_dispatch starting point with a typed input, ready to run from the Run workflow popover.',
    icon: octicons.zap,
    yaml: `name: Manual workflow

on:
  workflow_dispatch:
    inputs:
      reason:
        description: 'Why are you running this?'
        required: false
        type: string

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Print the reason
        run: echo "Triggered manually: \${{ inputs.reason }}"
`,
  }),
]

/** Workflow file basename, e.g. "ci.yml" from ".github/workflows/ci.yml". */
export const getWorkflowFileName = (path: string) =>
  path.split('/').pop() || path

/**
 * Map a workflow name or path onto the closest catalog glyph so workflow
 * manager rows get the same iconography as the template cards.
 */
export function getWorkflowGlyph(nameOrPath: string): OcticonSymbol {
  const value = nameOrPath.toLowerCase()
  if (/docker|container|image/.test(value)) {
    return octicons.container
  }
  if (/pages|site|deploy|publish|cd\b/.test(value)) {
    return octicons.globe
  }
  if (/codeql|security|scan|audit|dependency/.test(value)) {
    return octicons.codescan
  }
  if (/stale|schedule|cron|sweep/.test(value)) {
    return octicons.hourglass
  }
  if (/release|tag|version/.test(value)) {
    return octicons.tag
  }
  if (/lint|format|style/.test(value)) {
    return octicons.checklist
  }
  if (/test|spec|check/.test(value)) {
    return octicons.meter
  }
  if (/ci|build/.test(value)) {
    return octicons.beaker
  }
  return octicons.workflow
}
