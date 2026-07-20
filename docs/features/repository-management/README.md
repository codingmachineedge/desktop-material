# Repository management features

This category documents workflows that change which Git worktree Desktop
Material is displaying or how a repository is represented in the application.

## Features

- [Selective stashes](selective-stashes.md) — save only an exact reviewed set
  of whole changed files with repository-bound path validation.
- [Guided sparse checkout](sparse-checkout.md) — select, review every bounded
  normalized directory root, and apply cone-mode worktree changes through a
  retained result phase.
- [Named multi-stash manager](named-stash-manager.md) — create, inspect, apply,
  pop, rename, branch from, and clear exact object-identified stashes.
- [Advanced history
  discovery](advanced-history-discovery.md) — search rich commit metadata and
  page commits across local branches, remote-tracking branches, and tags while
  keeping cross-ref history read-only.
- [Reviewed bulk branch
  deletion](reviewed-bulk-branch-deletion.md) — select exact local branch tips,
  protect current/default/remote refs, and retain per-branch recovery IDs.
- [Network and WSL repository
  paths](network-and-wsl-repository-paths.md) — retain UNC roots, detect mapped
  drives and WSL shares, and provide offline reconnection guidance.
- [Reviewed batch repository sync](reviewed-batch-sync.md) — pull active
  branches or fetch only across an exact reviewed subset with bounded
  concurrency and isolated results.
- [External stash
  interoperability](external-stash-interoperability.md) — inspect and safely
  apply, restore, branch from, or explicitly discard stashes made by other Git
  clients without rewriting their metadata.
- [Repository picker filters and
  visibility](repository-picker-filters-and-visibility.md) — combine status,
  account, service, and text filters, and locally hide repositories with an
  explicit recovery path.
- [Tag lifecycle management](tag-lifecycle-management.md) — inventory, create,
  move, sign, push, fetch, prune, and explicitly delete local and remote tags
  through stale-safe reviewed operations.
- [Temporary submodule repository
  navigation](submodule-repository-navigation.md) — open an initialized
  submodule in the current workspace without importing it, then return to the
  persisted root repository.
- [Release-backed large-file
  storage](release-backed-cheap-lfs.md) — replace large tracked bytes with a
  verified GitHub Release pointer and materialize raw single or multipart
  assets safely.
- [Parent-folder repository
  discovery](parent-folder-repository-discovery.md) — preview and register a
  bounded, link-safe set of working trees below one selected folder.
- [Submodule, subtree, and remote creation
  workflows](submodule-subtree-and-remote-creation.md) — manage dependency
  topology and create an initialized account-bound remote before adding it as a
  submodule.

## API applicability

These features use the renderer, dispatcher, repository store, and bounded Git
helpers. They add no HTTP endpoint, so a Postman collection is not applicable.
