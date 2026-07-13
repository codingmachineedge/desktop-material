import { Account } from '../models/account'
import { getHTMLURL, IAPINotificationThread } from './api'

const safeRepositoryPart = /^[A-Za-z0-9_.-]+$/

/**
 * Convert known notification API resources to a provider HTML URL. Raw server
 * URLs are never opened: origins and repository identity must match the chosen
 * account, and unknown subjects fall back to the repository page.
 */
export function getGitHubNotificationURL(
  account: Account,
  thread: IAPINotificationThread
): string {
  const htmlBase = new URL(getHTMLURL(account.endpoint))
  const inboxURL = new URL('/notifications', htmlBase).toString()
  const repositoryParts = thread.repository.full_name.split('/')
  if (
    repositoryParts.length !== 2 ||
    !repositoryParts.every(
      part => safeRepositoryPart.test(part) && part !== '.' && part !== '..'
    )
  ) {
    return inboxURL
  }

  const [owner, repository] = repositoryParts
  const repositoryURL = new URL(
    `/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
    htmlBase
  )
  const subjectURL = thread.subject.url
  if (subjectURL === null) {
    return repositoryURL.toString()
  }

  try {
    const apiBase = new URL(account.endpoint)
    const parsedSubject = new URL(subjectURL)
    if (
      parsedSubject.origin !== apiBase.origin ||
      parsedSubject.username !== '' ||
      parsedSubject.password !== ''
    ) {
      return repositoryURL.toString()
    }

    const apiPrefix = `${apiBase.pathname.replace(/\/$/, '')}/repos/`
    if (!parsedSubject.pathname.startsWith(apiPrefix)) {
      return repositoryURL.toString()
    }
    const parts = decodeURIComponent(
      parsedSubject.pathname.slice(apiPrefix.length)
    ).split('/')
    if (
      parts.length < 4 ||
      parts[0].toLowerCase() !== owner.toLowerCase() ||
      parts[1].toLowerCase() !== repository.toLowerCase()
    ) {
      return repositoryURL.toString()
    }

    const resource = parts[2]
    const identifier = parts[3]
    let htmlPath: string | null = null
    if (
      (resource === 'issues' || resource === 'discussions') &&
      /^\d+$/.test(identifier)
    ) {
      htmlPath = `${resource}/${identifier}`
    } else if (resource === 'pulls' && /^\d+$/.test(identifier)) {
      htmlPath = `pull/${identifier}`
    } else if (resource === 'commits' && /^[0-9a-f]{7,64}$/i.test(identifier)) {
      htmlPath = `commit/${identifier}`
    } else if (
      resource === 'actions' &&
      parts[3] === 'runs' &&
      /^\d+$/.test(parts[4] ?? '')
    ) {
      htmlPath = `actions/runs/${parts[4]}`
    }

    return htmlPath === null
      ? repositoryURL.toString()
      : new URL(htmlPath, `${repositoryURL.toString()}/`).toString()
  } catch {
    return repositoryURL.toString()
  }
}
