import assert from 'node:assert'
import { describe, it } from 'node:test'
import { IAPINotificationThread } from '../../src/lib/api'
import { getGitHubNotificationURL } from '../../src/lib/github-notification-url'
import { Account } from '../../src/models/account'

function createAccount(endpoint = 'https://api.github.com'): Account {
  return new Account(
    'octocat',
    endpoint,
    'account-token',
    [],
    '',
    1,
    'The Octocat',
    'free'
  )
}

function createThread(
  subjectURL: string | null,
  fullName = 'octocat/desktop-material'
): IAPINotificationThread {
  return {
    id: '41',
    repository: {
      id: 1,
      name: 'desktop-material',
      full_name: fullName,
      private: false,
      owner: {
        login: 'octocat',
        id: 1,
        avatar_url: 'https://avatars.githubusercontent.com/u/1',
        html_url: 'https://github.com/octocat',
        type: 'User',
      },
      html_url: `https://github.com/${fullName}`,
    },
    subject: {
      title: 'A notification',
      url: subjectURL,
      latest_comment_url: null,
      type: 'Issue',
    },
    reason: 'mention',
    unread: true,
    updated_at: '2026-07-12T12:00:00Z',
    last_read_at: null,
    url: 'https://api.github.com/notifications/threads/41',
    subscription_url:
      'https://api.github.com/notifications/threads/41/subscription',
  }
}

describe('getGitHubNotificationURL', () => {
  it('converts known GitHub.com subject API resources to HTML URLs', () => {
    const account = createAccount()
    const cases = [
      ['issues/42', 'issues/42'],
      ['pulls/43', 'pull/43'],
      ['commits/0123456789abcdef', 'commit/0123456789abcdef'],
      ['discussions/44', 'discussions/44'],
      ['actions/runs/45', 'actions/runs/45'],
    ]

    for (const [apiPath, htmlPath] of cases) {
      assert.equal(
        getGitHubNotificationURL(
          account,
          createThread(
            `https://api.github.com/repos/octocat/desktop-material/${apiPath}`
          )
        ),
        `https://github.com/octocat/desktop-material/${htmlPath}`
      )
    }
  })

  it('converts a GitHub Enterprise API path to the provider HTML origin', () => {
    const account = createAccount('https://github.enterprise.test/api/v3')
    const thread = createThread(
      'https://github.enterprise.test/api/v3/repos/octocat/desktop-material/pulls/46'
    )

    assert.equal(
      getGitHubNotificationURL(account, thread),
      'https://github.enterprise.test/octocat/desktop-material/pull/46'
    )
  })

  it('falls back to the repository for mismatched origins and repositories', () => {
    const account = createAccount()
    const fallback = 'https://github.com/octocat/desktop-material'

    for (const subjectURL of [
      'https://example.test/repos/octocat/desktop-material/issues/1',
      'https://api.github.com/repos/another/repository/issues/1',
      'https://api.github.com/users/octocat',
    ]) {
      assert.equal(
        getGitHubNotificationURL(account, createThread(subjectURL)),
        fallback
      )
    }
  })

  it('falls back to the provider inbox for malformed repository names', () => {
    const account = createAccount()

    for (const fullName of [
      '',
      'octocat',
      'octocat/desktop-material/extra',
      'octocat/desktop material',
      '../desktop-material',
    ]) {
      assert.equal(
        getGitHubNotificationURL(
          account,
          createThread(
            'https://api.github.com/repos/octocat/desktop-material/issues/1',
            fullName
          )
        ),
        'https://github.com/notifications'
      )
    }
  })

  it('falls back to the repository for unknown or malformed subjects', () => {
    const account = createAccount()
    const fallback = 'https://github.com/octocat/desktop-material'

    for (const subjectURL of [
      null,
      'not a URL',
      'https://api.github.com/repos/octocat/desktop-material/releases/1',
      'https://api.github.com/repos/octocat/desktop-material/issues/not-a-number',
      'https://api.github.com/repos/octocat/desktop-material/commits/not-a-sha',
      'https://api.github.com/repos/octocat/desktop-material/actions/runs/not-a-number',
      'https://api.github.com/repos/octocat/desktop-material/issues/%E0%A4%A',
    ]) {
      assert.equal(
        getGitHubNotificationURL(account, createThread(subjectURL)),
        fallback
      )
    }
  })
})
