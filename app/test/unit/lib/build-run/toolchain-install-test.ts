import { describe, it } from 'node:test'
import assert from 'node:assert'
import { planToolchainInstall } from '../../../../src/lib/build-run/toolchain-install'

describe('planToolchainInstall', () => {
  it('returns null off Windows (winget is unavailable)', () => {
    assert.equal(planToolchainInstall('node', 'npm', 'linux'), null)
    assert.equal(planToolchainInstall('dotnet', 'dotnet', 'darwin'), null)
  })

  it('returns null for tools with no known install path', () => {
    assert.equal(planToolchainInstall('make', 'make', 'win32'), null)
    assert.equal(planToolchainInstall('cmake', 'cmake', 'win32'), null)
    assert.equal(planToolchainInstall('java', 'gradlew.bat', 'win32'), null)
  })

  describe('winget SDK ecosystems', () => {
    const cases: ReadonlyArray<{
      ecosystem: Parameters<typeof planToolchainInstall>[0]
      exe: string
      id: string
    }> = [
      { ecosystem: 'node', exe: 'npm', id: 'OpenJS.NodeJS' },
      { ecosystem: 'node', exe: 'node', id: 'OpenJS.NodeJS' },
      { ecosystem: 'python', exe: 'python', id: 'Python.Python.3.12' },
      { ecosystem: 'python', exe: 'python3', id: 'Python.Python.3.12' },
      { ecosystem: 'go', exe: 'go', id: 'GoLang.Go' },
      { ecosystem: 'rust', exe: 'cargo', id: 'Rustlang.Rustup' },
      { ecosystem: 'dotnet', exe: 'dotnet', id: 'Microsoft.DotNet.SDK.8' },
    ]

    for (const { ecosystem, exe, id } of cases) {
      it(`maps ${exe} to winget ${id} (elevated)`, () => {
        const plan = planToolchainInstall(ecosystem, exe, 'win32')
        assert.ok(plan)
        assert.equal(plan!.steps.length, 1)
        const [step] = plan!.steps
        assert.equal(step.command.exe, 'winget')
        assert.ok(step.command.args.includes('install'))
        assert.ok(step.command.args.includes(id))
        assert.equal(step.needsElevation, true)
        // Non-interactive: agreements must be pre-accepted so no prompt blocks.
        assert.ok(step.command.args.includes('--accept-package-agreements'))
        assert.ok(step.command.args.includes('--accept-source-agreements'))
      })
    }

    it('normalises path-qualified, extensioned executables', () => {
      const plan = planToolchainInstall(
        'python',
        'C:\\tools\\Python.exe',
        'win32'
      )
      assert.ok(plan)
      assert.ok(plan!.steps[0].command.args.includes('Python.Python.3.12'))
    })

    it('falls back to the ecosystem for an unrecognised executable name', () => {
      const plan = planToolchainInstall('dotnet', 'weird-wrapper', 'win32')
      assert.ok(plan)
      assert.ok(plan!.steps[0].command.args.includes('Microsoft.DotNet.SDK.8'))
    })
  })

  describe('corepack-provisioned package managers', () => {
    for (const exe of ['yarn', 'pnpm'] as const) {
      it(`provisions ${exe} via corepack enable (no elevation)`, () => {
        const plan = planToolchainInstall('node', exe, 'win32')
        assert.ok(plan)
        assert.equal(plan!.steps.length, 1)
        const [step] = plan!.steps
        assert.deepEqual(step.command, {
          exe: 'corepack',
          args: ['enable'],
          label: 'corepack enable',
        })
        assert.equal(step.needsElevation, false)
      })
    }
  })
})
