# Identity and workspace features

This category covers account selection and fast navigation when one Desktop
Material installation manages many identities, repositories, and branches.

## Features

- [Multiple accounts and repository
  identity](multiple-accounts-and-repository-identity.md)
- [Repository sidebar and
  pinning](repository-sidebar-and-pinning.md)
- [Branch switcher
  workflows](branch-switcher-workflows.md)
- [Owner-scoped appearance and
  history](owner-scoped-appearance-and-history.md)
- [Tab-strip settings commit
  chip](tab-strip-settings-commit-chip.md)
- [Settings search](settings-search.md)
- [Collection bulk actions and regex
  safety](collection-bulk-and-regex-safety.md)
- [Tab groups](tab-groups.md)

High-frequency visual edits are coalesced before persistence, while remote
default-branch lookup reuses only a namespace-validated local symbolic ref.
The cross-cutting lifecycle contract is documented under
[Quality and reliability](../quality-and-reliability/README.md).

## API applicability

Account-bound provider calls use the application's existing GitHub, GitLab,
and Bitbucket clients. These features add no standalone HTTP endpoint, so a
Postman collection is not applicable.
