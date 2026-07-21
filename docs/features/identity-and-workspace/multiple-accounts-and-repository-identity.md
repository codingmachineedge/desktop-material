# Multiple accounts and repository identity

Desktop Material can retain multiple GitHub.com identities, multiple accounts
on one Enterprise host, and GitLab or Bitbucket identities. Account metadata is
stored separately from credentials; tokens remain in the operating-system
credential vault.

Repository Settings exposes an exact account binding for provider operations
such as fetch, push, pull requests, issues, Actions, and Releases. The Git tab
independently chooses global or repository-local `user.name` and `user.email`,
so authentication identity and commit authorship are explicit instead of being
silently coupled.

## Organization Git operations

HTTPS Git operations carry the repository's stable `endpoint#id` account key
through normal and scheduled fetch, pull, push, post-push refresh, refspec
fetch, and remote-HEAD discovery. The key selects a credential-vault identity;
it is never a token, command-line argument, or environment variable. This
keeps a personal GitHub.com account from being selected merely because it was
signed in before the organization-authorized account.

An explicit binding is authoritative. If that account is no longer available,
the operation fails with account recovery rather than silently using another
same-host account. For a legacy unbound repository, Desktop Material checks
same-origin signed-in identities against the remote and prefers an account with
push or admin permission before a read-only account. A successful lookup is
then saved as the repository binding, so subsequent operations remain stable.

Changing the binding refreshes repository metadata and permissions under the
new identity. Saving an unrelated repository setting does not accidentally
bind the first same-host account. SAML reauthorization recognizes GitHub's
supported organization-quote formats, including repository-not-found ambiguity
when GitHub intentionally hides a private organization repository.

When a saved binding is missing, stale, lacks permission, or needs organization
SSO, the operation stops with the appropriate account-management or sign-in
recovery. A unique valid account may be suggested; ambiguous same-host matches
require a labelled user choice and never replace a still-valid binding.

The accounts store caps and validates persisted metadata, de-duplicates stable
account keys, and never writes tokens to its metadata file or application log.
Repository bindings use stable account keys rather than array positions.

Verification includes `accounts-store-test.ts`,
`get-account-for-repository-test.ts`, `repositories-store-test.ts`,
`push-authenticated-git-test.ts`, `pull-authenticated-git-test.ts`,
`fetch-authenticated-git-test.ts`,
`organization-repository-auth-wiring-test.ts`,
`saml-reauth-error-test.ts`, and the provider-triage UI/store suites.
