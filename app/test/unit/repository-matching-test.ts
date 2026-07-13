import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  matchGitHubRepository,
  urlMatchesRemote,
  urlMatchesCloneURL,
  urlsMatch,
} from '../../src/lib/repository-matching'
import { Account, getAccountKey } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'

describe('repository-matching', () => {
  describe('matchGitHubRepository', () => {
    it('matches HTTPS URLs', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'https://github.com/someuser/somerepo.git'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it('matches HTTPS URLs without the git extension', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'https://github.com/someuser/somerepo'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it('matches git URLs', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'git:github.com/someuser/somerepo.git'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it('matches SSH URLs', () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://api.github.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'git@github.com:someuser/somerepo.git'
      )
      assert(repo !== null)
      assert.equal(repo.name, 'somerepo')
      assert.equal(repo.owner, 'someuser')
    })

    it(`doesn't match if there aren't any users with that endpoint`, () => {
      const accounts = [
        new Account(
          'alovelace',
          'https://github.babbageinc.com',
          '',
          [],
          '',
          1,
          '',
          'free'
        ),
      ]
      const repo = matchGitHubRepository(
        accounts,
        'https://github.com/someuser/somerepo.git'
      )
      assert(repo === null)
    })

    it('matches a GitHub Enterprise HTTPS remote on a non-default port', () => {
      const account = new Account(
        'enterprise-user',
        'https://localhost:64301/api/v3',
        '',
        [],
        '',
        1,
        '',
        'free'
      )

      const repo = matchGitHubRepository(
        [account],
        'https://localhost:64301/material-proof/guided-proof.git'
      )

      assert(repo !== null)
      assert.equal(repo.name, 'guided-proof')
      assert.equal(repo.owner, 'material-proof')
      assert.equal(repo.account, account)
    })

    it('does not match a GitHub Enterprise remote on a different port', () => {
      const account = new Account(
        'enterprise-user',
        'https://localhost:64301/api/v3',
        '',
        [],
        '',
        1,
        '',
        'free'
      )

      assert.equal(
        matchGitHubRepository(
          [account],
          'https://localhost:64302/material-proof/guided-proof.git'
        ),
        null
      )
    })

    it('normalizes hostname casing and the default HTTPS port', () => {
      const account = new Account(
        'enterprise-user',
        'https://LOCALHOST:443/api/v3',
        '',
        [],
        '',
        1,
        '',
        'free'
      )

      const repo = matchGitHubRepository(
        [account],
        'https://localhost/material-proof/guided-proof.git'
      )

      assert(repo !== null)
      assert.equal(repo.account, account)
    })

    it('does not match a web remote from a different scheme origin', () => {
      const account = new Account(
        'enterprise-user',
        'http://localhost:80/api/v3',
        '',
        [],
        '',
        1,
        '',
        'free'
      )

      assert.equal(
        matchGitHubRepository(
          [account],
          'https://localhost/material-proof/guided-proof.git'
        ),
        null
      )
    })

    it('canonicalizes IPv6 authorities without dropping the port', () => {
      const account = new Account(
        'enterprise-user',
        'https://[0:0:0:0:0:0:0:1]:64301/api/v3',
        '',
        [],
        '',
        1,
        '',
        'free'
      )

      const repo = matchGitHubRepository(
        [account],
        'https://[::1]:64301/material-proof/guided-proof.git'
      )

      assert(repo !== null)
      assert.equal(repo.account, account)
      assert.equal(
        matchGitHubRepository(
          [account],
          'https://[::1]:64302/material-proof/guided-proof.git'
        ),
        null
      )
    })

    it('uses accountKey identity on a shared non-default-port origin', () => {
      const first = new Account(
        'first',
        'https://localhost:64301/api/v3',
        'first-token',
        [],
        '',
        1,
        '',
        'free'
      )
      const selected = new Account(
        'selected',
        'https://localhost:64301/api/v3',
        'selected-token',
        [],
        '',
        2,
        '',
        'free'
      )

      const repo = matchGitHubRepository(
        [first, selected],
        'https://localhost:64301/someuser/private-repo.git',
        getAccountKey(selected)
      )

      assert(repo !== null)
      assert.equal(repo.account, selected)
    })

    it('honors an exact repository account binding on a shared host', () => {
      const first = new Account(
        'first',
        'https://api.github.com',
        'first-token',
        [],
        '',
        1,
        '',
        'free'
      )
      const selected = new Account(
        'selected',
        'https://api.github.com',
        'selected-token',
        [],
        '',
        2,
        '',
        'free'
      )

      const repo = matchGitHubRepository(
        [first, selected],
        'https://github.com/someuser/private-repo.git',
        getAccountKey(selected)
      )

      assert(repo !== null)
      assert.equal(repo.account, selected)
      assert.equal(
        matchGitHubRepository(
          [first, selected],
          'https://github.com/someuser/private-repo.git',
          'signed-out-account'
        ),
        null
      )
    })
  })

  describe('urlMatchesRemote', () => {
    describe('with HTTPS remote', () => {
      const remote = {
        name: 'origin',
        url: 'https://github.com/shiftkey/desktop',
      }
      const remoteWithSuffix = {
        name: 'origin',
        url: 'https://github.com/shiftkey/desktop.git',
      }

      it('does not match null', () => {
        assert(!urlMatchesRemote(null, remoteWithSuffix))
      })

      it('matches cloneURL from API', () => {
        const cloneURL = 'https://github.com/shiftkey/desktop.git'
        assert(urlMatchesRemote(cloneURL, remoteWithSuffix))
      })

      it('matches cloneURL from API with different casing', () => {
        const cloneURL = 'https://GITHUB.COM/SHIFTKEY/DESKTOP.git'
        assert(urlMatchesRemote(cloneURL, remoteWithSuffix))
      })

      it('matches cloneURL from API without suffix', () => {
        const cloneURL = 'https://github.com/shiftkey/desktop.git'
        assert(urlMatchesRemote(cloneURL, remote))
      })

      it('matches htmlURL from API', () => {
        const htmlURL = 'https://github.com/shiftkey/desktop'
        assert(urlMatchesRemote(htmlURL, remoteWithSuffix))
      })

      it('matches htmlURL from API with different casing', () => {
        const htmlURL = 'https://GITHUB.COM/SHIFTKEY/DESKTOP'
        assert(urlMatchesRemote(htmlURL, remoteWithSuffix))
      })

      it('matches htmlURL from API without suffix', () => {
        const htmlURL = 'https://github.com/shiftkey/desktop'
        assert(urlMatchesRemote(htmlURL, remote))
      })

      it('normalizes a default HTTPS port', () => {
        const cloneURL = 'https://github.com:443/shiftkey/desktop.git'
        assert(urlMatchesRemote(cloneURL, remoteWithSuffix))
      })

      it('does not match a different web origin', () => {
        const differentPort = 'https://github.com:8443/shiftkey/desktop.git'
        const differentScheme = 'http://github.com/shiftkey/desktop.git'
        assert(!urlMatchesRemote(differentPort, remoteWithSuffix))
        assert(!urlMatchesRemote(differentScheme, remoteWithSuffix))
      })
    })

    describe('with SSH remote', () => {
      const remote = {
        name: 'origin',
        url: 'git@github.com:shiftkey/desktop.git',
      }
      it('does not match null', () => {
        assert(!urlMatchesRemote(null, remote))
      })

      it('matches cloneURL from API', () => {
        const cloneURL = 'https://github.com/shiftkey/desktop.git'
        assert(urlMatchesRemote(cloneURL, remote))
      })

      it('matches htmlURL from API', () => {
        const htmlURL = 'https://github.com/shiftkey/desktop'
        assert(urlMatchesRemote(htmlURL, remote))
      })
    })
  })

  describe('urlsMatch', () => {
    it('normalizes equivalent web authorities', () => {
      assert(
        urlsMatch(
          'https://LOCALHOST:443/owner/repository.git',
          'https://localhost/owner/repository.git'
        )
      )
    })

    it('does not match different web origins', () => {
      assert(
        !urlsMatch(
          'https://localhost:64301/owner/repository.git',
          'https://localhost:64302/owner/repository.git'
        )
      )
    })
  })

  describe('cloneUrlMatches', () => {
    const repository = gitHubRepoFixture({
      name: 'desktop',
      owner: 'shiftkey',
      isPrivate: false,
    })

    const repositoryWithoutCloneURL: GitHubRepository = {
      dbID: 1,
      name: 'desktop',
      fullName: 'shiftkey/desktop',
      cloneURL: null,
      owner: {
        login: 'shiftkey',
        id: 1234,
        endpoint: 'https://api.github.com/',
      },
      isPrivate: false,
      htmlURL: 'https://github.com/shiftkey/desktop',
      parent: null,
      endpoint: 'https://api.github.com/',
      fork: true,
      hash: 'whatever',
      issuesEnabled: true,
      isArchived: false,
      permissions: null,
    }

    it('returns true for exact match', () => {
      assert.equal(
        urlMatchesCloneURL(
          'https://github.com/shiftkey/desktop.git',
          repository
        ),
        true
      )
    })

    it(`returns true when URL doesn't have a .git suffix`, () => {
      assert.equal(
        urlMatchesCloneURL('https://github.com/shiftkey/desktop', repository),
        true
      )
    })

    it(`returns false when URL belongs to a different owner`, () => {
      assert.equal(
        urlMatchesCloneURL(
          'https://github.com/outofambit/desktop.git',
          repository
        ),
        false
      )
    })

    it(`returns false if GitHub repository does't have a cloneURL set`, () => {
      assert.equal(
        urlMatchesCloneURL(
          'https://github.com/shiftkey/desktop',
          repositoryWithoutCloneURL
        ),
        false
      )
    })
  })
})
