import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { IActionsJob } from '../../../src/lib/actions-jobs'
import { JobLogViewer } from '../../../src/ui/actions/job-log-viewer'
import { render, screen } from '../../helpers/ui/render'

const job = {
  name: 'build',
  htmlUrl: 'https://github.example/actions/jobs/1',
} as IActionsJob

describe('JobLogViewer', () => {
  it('labels search and announces its result count', () => {
    render(
      <JobLogViewer
        job={job}
        log={'first line\nsecond line'}
        loading={false}
        error={null}
        onClose={() => {}}
      />
    )

    assert.ok(screen.getByRole('searchbox', { name: 'Search logs' }))
    const status = screen.getByRole('status')
    assert.equal(status.getAttribute('aria-live'), 'polite')
    assert.equal(status.getAttribute('aria-atomic'), 'true')
    assert.equal(status.textContent, 'No matches')
  })
})
