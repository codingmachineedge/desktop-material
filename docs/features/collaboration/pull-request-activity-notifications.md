# Pull-request activity notifications

Desktop Material raises operating-system notifications for relevant pull
request review submissions, issue/review comments, and failed checks received
through its live provider event channel. Titles identify the actor/event and
the bounded body identifies the known pull request without exposing a token or
raw provider response.

Notifications are intentionally scoped to the selected GitHub repository and
pull requests already known to the local coordinator. Fork contribution mode
maps events to the configured parent or fork repository. Clicking a notification
revalidates its cached repository/PR context and opens the matching review,
comment, or checks workflow in Desktop Material.

Missing accounts, unknown PRs/comments/reviews, invalid review states, unrelated
repositories, and unsuccessful provider lookups are ignored rather than
displaying an unactionable alert. Failed-check notifications require a commit
authored by the bound account and de-duplicate check runs/suites so re-delivered
events do not spam the user.

The event payload is passed as operating-system notification user data only for
the activation route; credentials are never included. The renderer/main-process
bridge uses the platform notification implementation and a testable fallback.

Verification includes the notifications store/debug store, valid-review,
check-status, main-process notification bridge, and notification dialog suites.
