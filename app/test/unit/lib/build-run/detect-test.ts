import { describe, it } from 'node:test'
import assert from 'node:assert'
import { detectProfiles } from '../../../../src/lib/build-run/detect'
import { IRepoFileProbe } from '../../../../src/lib/build-run/types'

interface IProbeInput {
  readonly paths?: ReadonlyArray<string>
  readonly files?: ReadonlyArray<string>
  readonly texts?: Readonly<Record<string, string>>
  readonly platform?: NodeJS.Platform
}

function makeProbe(input: IProbeInput): IRepoFileProbe {
  const files = input.files ?? []
  const paths = new Set<string>([...(input.paths ?? []), ...files])
  const texts = input.texts ?? {}
  return {
    exists: p => paths.has(p),
    readText: p => texts[p] ?? null,
    sampleFiles: files,
    platform: input.platform ?? 'win32',
  }
}

const pkg = (extra: object = {}) => JSON.stringify(extra)

describe('detectProfiles', () => {
  it('returns nothing for an empty repository', () => {
    const result = detectProfiles(makeProbe({}))
    assert.equal(result.length, 0)
  })

  describe('node', () => {
    it('detects npm from package-lock.json and uses ci when locked', () => {
      const probe = makeProbe({
        files: ['package.json', 'package-lock.json'],
        texts: {
          'package.json': pkg({ scripts: { build: 'tsc', dev: 'vite' } }),
        },
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.ecosystem, 'node')
      assert.equal(profile.cwd, '')
      assert.deepEqual(profile.install?.[0], {
        exe: 'npm',
        args: ['ci'],
        label: 'npm ci',
      })
      assert.deepEqual(profile.build?.[0].args, ['run', 'build'])
      assert.deepEqual(profile.run?.[0].args, ['run', 'dev'])
      // 10 (package.json) + 3 (lockfile) + 2 (build) + 2 (dev) = 17
      assert.equal(profile.score, 17)
      assert.equal(profile.gitignoreTemplateId, 'node')
    })

    it('uses install (not ci) when no lockfile is present', () => {
      const probe = makeProbe({
        files: ['package.json'],
        texts: { 'package.json': pkg({}) },
      })
      const [profile] = detectProfiles(probe)
      assert.deepEqual(profile.install?.[0].args, ['install'])
      assert.equal(profile.score, 10)
      assert.equal(profile.run, undefined)
      assert.equal(profile.build, undefined)
    })

    it('resolves yarn from yarn.lock', () => {
      const probe = makeProbe({
        files: ['package.json', 'yarn.lock'],
        texts: { 'package.json': pkg({ scripts: { start: 'node .' } }) },
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.install?.[0].exe, 'yarn')
      assert.deepEqual(profile.run?.[0].args, ['run', 'start'])
    })

    it('resolves pnpm from pnpm-lock.yaml', () => {
      const probe = makeProbe({
        files: ['package.json', 'pnpm-lock.yaml'],
        texts: { 'package.json': pkg({}) },
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.install?.[0].exe, 'pnpm')
    })

    it('flags an electron app and prefers its run script', () => {
      const probe = makeProbe({
        files: ['package.json'],
        texts: {
          'package.json': pkg({
            devDependencies: { electron: '^30' },
            scripts: { electron: 'electron .', start: 'node .' },
          }),
        },
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.label, 'Electron app')
      assert.deepEqual(profile.run?.[0].args, ['run', 'electron'])
    })

    it('flags a tauri app and adds src-tauri/target to ignores', () => {
      const probe = makeProbe({
        files: ['package.json', 'src-tauri/Cargo.toml'],
        texts: { 'package.json': pkg({}) },
      })
      const profiles = detectProfiles(probe)
      const node = profiles.find(p => p.ecosystem === 'node')!
      assert.equal(node.label, 'Tauri app')
      assert.ok(node.extraIgnores.includes('src-tauri/target/'))
    })

    it('tolerates malformed package.json', () => {
      const probe = makeProbe({
        files: ['package.json'],
        texts: { 'package.json': '{ not json' },
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.ecosystem, 'node')
      assert.equal(profile.run, undefined)
    })
  })

  describe('rust', () => {
    it('detects a runnable binary crate', () => {
      const probe = makeProbe({
        files: ['Cargo.toml', 'Cargo.lock', 'src/main.rs'],
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.ecosystem, 'rust')
      assert.deepEqual(profile.build?.[0].args, ['build'])
      assert.deepEqual(profile.run?.[0].args, ['run'])
      assert.equal(profile.score, 13)
    })

    it('skips run for a library-only crate', () => {
      const probe = makeProbe({ files: ['Cargo.toml', 'src/lib.rs'] })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.run, undefined)
    })
  })

  describe('go', () => {
    it('detects a go module', () => {
      const probe = makeProbe({ files: ['go.mod', 'go.sum', 'main.go'] })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.ecosystem, 'go')
      assert.deepEqual(profile.install?.[0].args, ['mod', 'download'])
      assert.deepEqual(profile.build?.[0].args, ['build', './...'])
      assert.equal(profile.score, 13)
    })
  })

  describe('dotnet', () => {
    it('offers run for a project file', () => {
      const probe = makeProbe({ files: ['App/App.csproj'] })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.ecosystem, 'dotnet')
      assert.ok(profile.run !== undefined)
    })

    it('omits run for a solution-only repo', () => {
      const probe = makeProbe({ files: ['App.sln'] })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.ecosystem, 'dotnet')
      assert.equal(profile.run, undefined)
    })

    it('uses --project for a single project so run is unambiguous', () => {
      const probe = makeProbe({ files: ['App.csproj'] })
      const [profile] = detectProfiles(probe)
      assert.deepEqual(profile.run?.[0].args, ['run', '--project', 'App.csproj'])
      assert.deepEqual(profile.build?.[0].args, ['build', 'App.csproj'])
    })

    it('returns one profile per project when several .csproj exist', () => {
      const probe = makeProbe({ files: ['Api.csproj', 'Worker.csproj'] })
      const dotnet = detectProfiles(probe).filter(p => p.ecosystem === 'dotnet')
      assert.equal(dotnet.length, 2)
      const ids = dotnet.map(p => p.id).sort()
      assert.deepEqual(ids, ['dotnet:Api', 'dotnet:Worker'])
      const api = dotnet.find(p => p.id === 'dotnet:Api')!
      assert.equal(api.label, '.NET · Api')
      assert.deepEqual(api.run?.[0].args, ['run', '--project', 'Api.csproj'])
      // Each project targets only its own file, never a bare `dotnet run`.
      for (const p of dotnet) {
        assert.ok(p.run?.[0].args.includes('--project'))
      }
    })

    it('returns one build-only profile per solution when several .sln exist', () => {
      const probe = makeProbe({ files: ['One.sln', 'Two.sln'] })
      const dotnet = detectProfiles(probe).filter(p => p.ecosystem === 'dotnet')
      assert.equal(dotnet.length, 2)
      assert.deepEqual(dotnet.map(p => p.id).sort(), [
        'dotnet:One',
        'dotnet:Two',
      ])
      for (const p of dotnet) {
        assert.equal(p.run, undefined)
        assert.ok(p.build?.[0].args.some(a => a.endsWith('.sln')))
      }
    })

    it('surfaces a solution build plus a profile per nested project', () => {
      const probe = makeProbe({
        files: ['My.sln', 'src/Api/Api.csproj', 'src/Web/Web.csproj'],
      })
      const dotnet = detectProfiles(probe).filter(p => p.ecosystem === 'dotnet')
      // One solution (root) + two nested project profiles.
      assert.equal(dotnet.length, 3)
      const solution = dotnet.find(p => p.cwd === '')!
      assert.equal(solution.run, undefined)
      const projects = dotnet.filter(p => p.cwd !== '')
      assert.equal(projects.length, 2)
      for (const p of projects) {
        assert.ok(p.run !== undefined)
      }
    })
  })

  describe('python', () => {
    it('creates a venv and installs requirements on windows', () => {
      const probe = makeProbe({
        files: ['requirements.txt', 'main.py'],
        platform: 'win32',
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.ecosystem, 'python')
      assert.equal(profile.install?.[0].label, 'create .venv')
      assert.equal(profile.install?.[1].exe, '.venv\\Scripts\\pip.exe')
      assert.deepEqual(profile.install?.[1].args, [
        'install',
        '-r',
        'requirements.txt',
      ])
      assert.equal(profile.run?.[0].exe, '.venv\\Scripts\\python.exe')
    })

    it('uses posix venv paths off windows', () => {
      const probe = makeProbe({
        files: ['requirements.txt'],
        platform: 'linux',
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.install?.[1].exe, '.venv/bin/pip')
    })

    it('detects a django runserver entrypoint', () => {
      const probe = makeProbe({ files: ['requirements.txt', 'manage.py'] })
      const [profile] = detectProfiles(probe)
      assert.deepEqual(profile.run?.[0].args, ['manage.py', 'runserver'])
    })

    it('detects uvicorn from requirements text', () => {
      const probe = makeProbe({
        files: ['requirements.txt'],
        texts: { 'requirements.txt': 'fastapi\nuvicorn[standard]\n' },
      })
      const [profile] = detectProfiles(probe)
      assert.ok(profile.run?.[0].args.includes('uvicorn'))
    })
  })

  describe('java', () => {
    it('prefers the gradle wrapper', () => {
      const probe = makeProbe({
        files: ['gradlew.bat', 'build.gradle'],
        platform: 'win32',
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.ecosystem, 'java')
      assert.equal(profile.build?.[0].exe, 'gradlew.bat')
      assert.equal(profile.score, 13)
    })

    it('falls back to maven on pom.xml', () => {
      const probe = makeProbe({ files: ['pom.xml'] })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.build?.[0].exe, 'mvn')
      assert.equal(profile.run, undefined)
    })
  })

  describe('cmake and make', () => {
    it('detects cmake with a two-step build', () => {
      const probe = makeProbe({ files: ['CMakeLists.txt'] })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.ecosystem, 'cmake')
      assert.equal(profile.build?.length, 2)
      assert.equal(profile.gitignoreTemplateId, '')
    })

    it('detects make with a run target', () => {
      const probe = makeProbe({
        files: ['Makefile'],
        texts: { Makefile: 'build:\n\tgcc\nrun:\n\t./a.out\n' },
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.ecosystem, 'make')
      assert.ok(profile.run !== undefined)
    })

    it('omits make run when no run target exists', () => {
      const probe = makeProbe({
        files: ['Makefile'],
        texts: { Makefile: 'all:\n\tgcc\n' },
      })
      const [profile] = detectProfiles(probe)
      assert.equal(profile.run, undefined)
    })

    it('suppresses the make fallback when a real ecosystem matches', () => {
      const probe = makeProbe({
        files: ['Makefile', 'Cargo.toml', 'src/main.rs'],
      })
      const ecosystems = detectProfiles(probe).map(p => p.ecosystem)
      assert.ok(ecosystems.includes('rust'))
      assert.ok(!ecosystems.includes('make'))
    })
  })

  describe('ranking and nesting', () => {
    it('applies a nested penalty and marks the cwd', () => {
      const probe = makeProbe({
        files: ['package.json', 'server/go.mod'],
        texts: { 'package.json': pkg({}) },
      })
      const profiles = detectProfiles(probe)
      const go = profiles.find(p => p.ecosystem === 'go')!
      assert.equal(go.cwd, 'server')
      assert.equal(go.id, 'go:server')
      // 10 (go.mod) − 4 (nested) = 6
      assert.equal(go.score, 6)
      const node = profiles.find(p => p.ecosystem === 'node')!
      assert.ok(node.score > go.score)
      assert.equal(profiles[0].ecosystem, 'node')
    })

    it('sorts by score desc then label asc and caps at six', () => {
      const probe = makeProbe({
        files: [
          'package.json',
          'Cargo.toml',
          'src/main.rs',
          'go.mod',
          'pom.xml',
          'CMakeLists.txt',
          'App.csproj',
          'requirements.txt',
        ],
        texts: { 'package.json': pkg({}) },
      })
      const profiles = detectProfiles(probe)
      assert.equal(profiles.length, 6)
      const scores = profiles.map(p => p.score)
      const sorted = [...scores].sort((a, b) => b - a)
      assert.deepEqual(scores, sorted)
    })
  })
})
