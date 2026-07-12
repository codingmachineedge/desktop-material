import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import {
  DesktopMaterialCLIName,
  formatCLIHelp,
  parseCLIArguments,
} from '../../src/cli/arguments'

const cwd = resolve('C:\\work')

describe('Desktop Material CLI', () => {
  it('opens the current directory when invoked without arguments', () => {
    assert.deepEqual(parseCLIArguments([], cwd), {
      kind: 'open',
      path: cwd,
    })
  })

  it('opens a direct relative path', () => {
    assert.deepEqual(parseCLIArguments(['project'], cwd), {
      kind: 'open',
      path: resolve(cwd, 'project'),
    })
  })

  it('supports the explicit open command', () => {
    assert.deepEqual(parseCLIArguments(['open', 'project'], cwd), {
      kind: 'open',
      path: resolve(cwd, 'project'),
    })
  })

  it('expands an owner/repository clone target', () => {
    assert.deepEqual(parseCLIArguments(['clone', 'octocat/Hello-World'], cwd), {
      kind: 'clone',
      url: 'https://github.com/octocat/Hello-World',
      branch: undefined,
    })
  })

  it('keeps a full clone URL and accepts a branch option', () => {
    assert.deepEqual(
      parseCLIArguments(
        [
          'clone',
          '--branch=develop',
          'https://example.com/example/project.git',
        ],
        cwd
      ),
      {
        kind: 'clone',
        url: 'https://example.com/example/project.git',
        branch: 'develop',
      }
    )
  })

  it('accepts a short branch option after the clone target', () => {
    assert.deepEqual(
      parseCLIArguments(['clone', 'owner/repo', '-b', 'release'], cwd),
      {
        kind: 'clone',
        url: 'https://github.com/owner/repo',
        branch: 'release',
      }
    )
  })

  it('reports incomplete and unknown commands', () => {
    assert.deepEqual(parseCLIArguments(['clone'], cwd), {
      kind: 'error',
      message: 'The clone command requires a URL or OWNER/REPOSITORY.',
    })
    assert.deepEqual(parseCLIArguments(['clone', '-b'], cwd), {
      kind: 'error',
      message: 'Option -b requires a branch name.',
    })
    assert.deepEqual(parseCLIArguments(['--unknown'], cwd), {
      kind: 'error',
      message: 'Unknown option: --unknown',
    })
  })

  it('supports help and version aliases', () => {
    assert.deepEqual(parseCLIArguments(['-h'], cwd), { kind: 'help' })
    assert.deepEqual(parseCLIArguments(['help'], cwd), { kind: 'help' })
    assert.deepEqual(parseCLIArguments(['-v'], cwd), { kind: 'version' })
    assert.deepEqual(parseCLIArguments(['version'], cwd), { kind: 'version' })
  })

  it('provides branded, example-rich help', () => {
    const help = formatCLIHelp()
    assert.match(help, /Desktop Material command line/)
    assert.match(help, /desktop-material clone/)
    assert.match(help, /octocat\/Hello-World/)
    assert.doesNotMatch(help, /GitHub Desktop CLI/)
  })

  it('ships a branded launcher for every supported platform', async () => {
    const staticRoot = resolve(__dirname, '../../static')
    const launchers = [
      ['win32', `${DesktopMaterialCLIName}.bat`],
      ['win32', `${DesktopMaterialCLIName}.sh`],
      ['darwin', `${DesktopMaterialCLIName}.sh`],
      ['linux', DesktopMaterialCLIName],
    ] as const

    for (const [platform, file] of launchers) {
      const launcher = await readFile(
        resolve(staticRoot, platform, file),
        'utf8'
      )
      assert.match(launcher, /ELECTRON_RUN_AS_NODE=1/)
      assert.match(launcher, /cli\.js/)
    }
  })
})
