# GitHub CLI push credential fallback

When a push to an organization-owned GitHub or GitHub Enterprise Server (GHES)
repository is rejected for authentication reasons, Desktop Material can retry the
push exactly once using the developer's [GitHub CLI](https://cli.github.com/)
(`gh`) credentials. This rescues the common case where the account token bound to
a repository lacks push rights for an organization, but the developer's `gh`
login (often carrying broader SSO/organization authorization) does.

## Behavior

1. A push runs normally through the store's `performPush`
   (`app/src/lib/stores/app-store.ts`) and `push()`
   (`app/src/lib/git/push.ts`).
2. If it fails, the fallback decision
   (`shouldRetryPushWithGitHubCLICredentials` in `app/src/lib/gh-cli.ts`) is
   evaluated **lazily** — only after a failure, so the happy path never spawns
   `gh`.
3. The retry fires only when **all** of the following hold:
   - the failure is an authentication/permission error
     (`HTTPSAuthenticationFailed`, `SSHAuthenticationFailed`, or
     `SSHPermissionDenied`, via Desktop's existing `isAuthFailureError` taxonomy);
   - the repository is one Desktop knows lives on GitHub/GHES;
   - the remote is an **HTTPS** remote (only HTTPS remotes can be served by the
     `gh` credential helper — SSH remotes are skipped);
   - the repository is **organization-owned**, or its owner login differs from
     the signed-in account's login (a transferred repo or fork);
   - `gh` is **installed** (`gh --version`) and **authenticated for that host**
     (`gh auth status --hostname <host>`).
4. On a qualifying failure the push is re-run **once** with Git configured to
   resolve credentials through `gh`:

   ```
   git -c credential.helper= \
       -c 'credential.helper=!gh auth git-credential' \
       push <remote> <refspec> …
   ```

   These `-c` flags are injected **before** the `push` subcommand (see
   `buildPushArgv` and `git()` in `git/core.ts`), which is the only position
   where per-command config overrides take effect.
5. On retry success, a **non-blocking** notification —
   *"Pushed using GitHub CLI credentials"* — is posted to the notification
   centre.
6. On a double failure, the **original** push error (not the `gh` retry's error)
   is surfaced through Desktop's normal push error handling, preserving the
   familiar authentication dialog and its retry affordance.

The publish-repository flow (`_publishRepository`) pushes through the same
`performPush`, so it inherits the fallback with no additional wiring.

## Configuration

There is no user-facing toggle. The fallback is inert unless every trigger
condition is met, and it self-limits to a single retry. To make it available,
install and sign in to the GitHub CLI:

```
gh auth login --hostname github.com        # or your GHES hostname
```

Desktop honors whatever host(s) `gh` is authenticated for. On Windows the CLI is
invoked as the real `gh.exe` binary.

## Failure modes

| Situation | Result |
| --- | --- |
| `gh` not installed | `gh --version` fails; no retry; original error surfaced. |
| `gh` not signed in for the host | `gh auth status` non-zero; no retry. |
| SSH remote | Not eligible (no HTTPS host); no retry. |
| Non-GitHub remote (e.g. GitLab) | Not a known GitHub repository; no retry. |
| Personal repo owned by the signed-in user | Not org-owned and owner matches; no retry. |
| Non-auth failure (e.g. non-fast-forward) | Not an auth error; no retry, no `gh` spawn. |
| Retry also fails | Original failure surfaced; `onFailure` logs (no token). |

Every probe is wrapped so it never throws: any uncertainty resolves to "do not
retry", leaving the original failure untouched.

## Security considerations

- **No token ever appears in argv, environment, or logs.** The injected config
  is a *command* (`!gh auth git-credential`) that Git invokes on demand; `gh`
  resolves the token out-of-process. Desktop only reads `gh`'s **exit status**,
  never its stdout/stderr, and never passes `--show-token`.
- **Why `credential.helper=` is reset first.** The leading empty
  `credential.helper=` clears every helper inherited from system/global/local
  Git config so that `gh` is the *sole* credential source for the retry.
  Without the reset, a previously configured helper (for example the platform
  credential manager) would answer first — most likely re-offering the very
  token that was just rejected — and `gh` would never be consulted.
- **`gh` is never handed a credentialed URL.** The host passed to
  `gh auth status` is derived with `URL.hostname`, which excludes any port and,
  critically, any `user:token@` userinfo. A remote URL that embedded a secret
  cannot leak it into the `gh` command line.
- **`shell: false` only.** `gh` is spawned through `execFile` (never a shell),
  and Windows targets the genuine `gh.exe` PE binary rather than a `.cmd`/`.bat`
  shim, avoiding shell argument-injection paths.

## Verification

Unit tests (no network, no real `gh`, no Git execution):

- `app/test/unit/gh-cli-test.ts` — executable detection, the exact `-c` argument
  vector (asserting no token / no credentialed URL), hostname extraction
  (including stripping embedded credentials), organization/owner eligibility,
  and the full `shouldRetryPushWithGitHubCLICredentials` decision across
  org/personal/SSH/non-GitHub/`gh`-missing scenarios using an injected fake
  process runner.
- `app/test/unit/git/push-fallback-test.ts` — `buildPushArgv` argv ordering,
  single-retry-only enforcement, the success path being untouched, original-error
  surfacing on double failure, and that the ordinary push flow and the publish
  flow drive the mechanism identically.
