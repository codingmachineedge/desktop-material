# Copilot commit-message controls

Eligible signed-in users can ask Copilot to draft a commit title and optional
description from the currently included diff. The generated marker is cleared
as soon as the user edits either field, so telemetry and commit metadata never
claim that a user-written message is still verbatim generated text.

The Copilot Preferences tab checks access, explains missing licenses or a
disabled Desktop entitlement, and provides sign-in, plan, and feature-setting
recovery. It offers a persisted model choice for commit-message generation,
including account-scoped Copilot models and validated bring-your-own-provider
profiles. The commit composer always retains manual title/description controls;
generation is an explicit button, never a prerequisite for committing.

Requests use only the selected repository/account context, a bounded timeout,
an in-memory session filesystem, and structured response validation. Tokens and
provider secrets are supplied through the credential-backed configuration and
are not written into prompts, repository files, or logs. Cancellation and
billing/session errors preserve the user's existing draft.

Verification includes the Copilot store, prompt, response parser, in-memory
filesystem, model-picker, payment/error presentation, and commit-message UI
test suites.
