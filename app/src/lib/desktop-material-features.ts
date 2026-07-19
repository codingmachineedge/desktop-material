/**
 * Stable command and menu entry points implemented by Desktop Material rather
 * than stock GitHub Desktop. Keep this allowlist conservative: a false
 * negative is less confusing than labelling an upstream or mixed surface.
 */
export const DesktopMaterialFeatureEntryPointIds: ReadonlySet<string> = new Set(
  [
    'build-and-run',
    'export-repository-list',
    'export-tab-session',
    'import-repository-list',
    'import-tab-session',
    'inspect-branch-rules',
    'manage-gitignore',
    'manage-sparse-checkout',
    'permanently-discard-all-changes',
    'show-repository-tools',
    'show-settings-history',
    'squash-and-merge-branch',
    'view-log-history',
  ]
)

export function isDesktopMaterialFeatureEntryPoint(id: string): boolean {
  return DesktopMaterialFeatureEntryPointIds.has(id)
}
