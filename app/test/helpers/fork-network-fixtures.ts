import {
  IAPIForkNetworkBranch,
  IAPIFullRepository,
  IAPIIdentity,
} from '../../src/lib/api'

export function forkNetworkIdentity(login: string, id = 1): IAPIIdentity {
  return {
    id,
    login,
    avatar_url: `https://avatars.githubusercontent.com/u/${id}`,
    html_url: `https://github.com/${login}`,
    type: 'User',
  }
}

export function forkNetworkRootFixture(): IAPIFullRepository {
  return {
    clone_url: 'https://github.com/upstream/project.git',
    ssh_url: 'git@github.com:upstream/project.git',
    html_url: 'https://github.com/upstream/project',
    name: 'project',
    owner: forkNetworkIdentity('upstream'),
    private: false,
    fork: false,
    default_branch: 'main',
    pushed_at: '2026-01-01T00:00:00Z',
    has_issues: true,
    archived: false,
    parent: undefined,
  }
}

export function forkNetworkRepositoryFixture(
  owner: string,
  overrides: Partial<IAPIFullRepository> = {}
): IAPIFullRepository {
  const root = forkNetworkRootFixture()
  return {
    ...root,
    clone_url: `https://github.com/${owner}/project.git`,
    ssh_url: `git@github.com:${owner}/project.git`,
    html_url: `https://github.com/${owner}/project`,
    owner: forkNetworkIdentity(owner, 2),
    fork: true,
    parent: root,
    ...overrides,
  }
}

export function forkNetworkBranchFixture(
  name: string,
  sha = 'a'.repeat(40),
  protectedBranch = false
): IAPIForkNetworkBranch {
  return {
    name,
    protected: protectedBranch,
    commit: { sha },
  }
}
