export function createReleaseVersion(baseVersion: string, runId: string): string

export function compareReleaseVersions(
  leftVersion: string,
  rightVersion: string
): -1 | 0 | 1

export function selectHighestReleaseTag(tags: ReadonlyArray<string>): string
