#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${RELEASE_TARGET_SHA:?RELEASE_TARGET_SHA is required}"
: "${RELEASE_TAG:?RELEASE_TAG is required}"

if [[ ! "$RELEASE_TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Release target is not an exact commit SHA." >&2
  exit 1
fi

resolve_main() {
  git ls-remote origin refs/heads/main | awk 'NR == 1 { print $1 }'
}

release_tags_for_target() {
  gh api "repos/$GITHUB_REPOSITORY/releases?per_page=100" \
    --jq ".[] | select(.draft == false and .target_commitish == \"$RELEASE_TARGET_SHA\") | .tag_name"
}

select_highest_target_tag() {
  local tags
  tags=$(release_tags_for_target)
  if [ -z "$tags" ]; then
    echo "No published releases target $RELEASE_TARGET_SHA." >&2
    return 1
  fi
  printf '%s\n' "$tags" | node script/release-version.js max
}

promote_tag() {
  local tag="$1"
  local release_id
  release_id=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$tag" --jq .id)
  if [[ ! "$release_id" =~ ^[0-9]+$ ]]; then
    echo "Published Release $tag did not return a numeric database ID." >&2
    return 1
  fi
  gh api --method PATCH \
    "repos/$GITHUB_REPOSITORY/releases/$release_id" \
    -f make_latest=true >/dev/null
}

demote_if_latest() {
  local tag="$1"
  local latest
  latest=$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name)
  if [ "$latest" != "$tag" ]; then
    return 0
  fi

  local release_id
  release_id=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$tag" --jq .id)
  gh api --method PATCH \
    "repos/$GITHUB_REPOSITORY/releases/$release_id" \
    -f make_latest=false >/dev/null

  latest=$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name)
  if [ "$latest" = "$tag" ]; then
    echo "Superseded Release still owns Latest after demotion." >&2
    return 1
  fi
}

set +e
current_main=$(resolve_main)
lookup_status=$?
set -e
if [ "$lookup_status" -ne 0 ] || [[ ! "$current_main" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::warning::Could not resolve current main; the immutable Release remains non-latest."
  exit 0
fi
if [ "$current_main" != "$RELEASE_TARGET_SHA" ]; then
  echo "::notice::Published superseded commit $RELEASE_TARGET_SHA without changing Latest; current main is $current_main."
  exit 0
fi

selected_tag=$(select_highest_target_tag)
if [ "$selected_tag" != "$RELEASE_TAG" ]; then
  echo "::notice::Release $selected_tag outranks candidate $RELEASE_TAG for the same source commit."
fi
promote_tag "$selected_tag"

set +e
current_main_after=$(resolve_main)
after_status=$?
set -e
if [ "$after_status" -ne 0 ] || [ "$current_main_after" != "$RELEASE_TARGET_SHA" ]; then
  demote_if_latest "$selected_tag"
  echo "::notice::Main advanced during Latest promotion; the Release remains published but was demoted from Latest."
  exit 0
fi

# A same-SHA release can finish between selection and promotion. Reconcile once
# more so a lower run can never leave Latest pointing below a published higher
# version for that exact source.
reconciled_tag=$(select_highest_target_tag)
if [ "$reconciled_tag" != "$selected_tag" ]; then
  promote_tag "$reconciled_tag"
  selected_tag="$reconciled_tag"
fi

set +e
current_main_final=$(resolve_main)
final_status=$?
set -e
if [ "$final_status" -ne 0 ] || [ "$current_main_final" != "$RELEASE_TARGET_SHA" ]; then
  demote_if_latest "$selected_tag"
  echo "::notice::Main advanced during Latest reconciliation; the Release remains published but was demoted from Latest."
  exit 0
fi

latest=$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name)
if [ "$latest" != "$selected_tag" ]; then
  echo "Latest Release is $latest, expected highest same-source tag $selected_tag." >&2
  exit 1
fi
