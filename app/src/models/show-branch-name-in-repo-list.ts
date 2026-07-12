export enum ShowBranchNameInRepoListSetting {
  Never = 'Never',
  Always = 'Always',
  WhenNotDefault = 'WhenNotDefault',
}

export const defaultShowBranchNameInRepoListSetting =
  ShowBranchNameInRepoListSetting.Never

export const shouldShowBranchName = (
  setting: ShowBranchNameInRepoListSetting,
  branchName: string | null,
  defaultBranchName: string | null
) =>
  branchName !== null &&
  (setting === ShowBranchNameInRepoListSetting.Always ||
    (setting === ShowBranchNameInRepoListSetting.WhenNotDefault &&
      branchName !== defaultBranchName))
