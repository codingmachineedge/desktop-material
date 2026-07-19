import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  ForkBranchCheckoutError,
  IForkBranchCheckoutPlan,
  IForkNetworkBranchCatalog,
  IForkNetworkCatalog,
} from '../../../src/lib/fork-network'
import { translate } from '../../../src/lib/i18n'
import { Repository } from '../../../src/models/repository'
import { ForkBranchCheckout } from '../../../src/ui/branches/fork-branch-checkout'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const fork = {
  id: 'alice/project',
  owner: 'alice',
  name: 'project',
  cloneURL: 'https://github.com/alice/project.git',
  htmlURL: 'https://github.com/alice/project',
  isPrivate: false,
  defaultBranch: 'main',
}
const selectedBranch = {
  id: `feature%2Freview@${'a'.repeat(40)}`,
  name: 'feature/review',
  headSha: 'a'.repeat(40),
  protected: false,
}
const network: IForkNetworkCatalog = {
  repositoryIdentity: '1'.repeat(64),
  rootOwner: 'upstream',
  rootName: 'project',
  forks: [fork],
  truncated: true,
  rejectedCount: 0,
  snapshotToken: '2'.repeat(64),
}
const branches: IForkNetworkBranchCatalog = {
  repositoryIdentity: network.repositoryIdentity,
  rootOwner: network.rootOwner,
  rootName: network.rootName,
  fork,
  branches: [selectedBranch],
  truncated: false,
  rejectedCount: 1,
  snapshotToken: '3'.repeat(64),
}

function plan(localBranchName: string): IForkBranchCheckoutPlan {
  return {
    repositoryIdentity: network.repositoryIdentity,
    rootOwner: network.rootOwner,
    rootName: network.rootName,
    fork,
    branch: selectedBranch,
    branchCatalogToken: branches.snapshotToken,
    localBranchName,
    remoteName: 'github-desktop-alice',
    remoteRef: 'refs/remotes/github-desktop-alice/feature/review',
    expectedRemoteInventoryToken: '4'.repeat(64),
    remoteWillBeCreated: true,
    reviewToken: '5'.repeat(64),
  }
}

describe('fork branch checkout surface', () => {
  it('reviews and submits one exact fork, branch head, local branch, and managed ref', async () => {
    const reviews = new Array<{
      catalog: IForkNetworkBranchCatalog
      localBranchName: string
    }>()
    const checkouts = new Array<IForkBranchCheckoutPlan>()
    const repository = new Repository('C:\\repo', 1, null, false)
    render(
      <ForkBranchCheckout
        repository={repository}
        dispatcher={{
          loadForkNetworkRepositories: async () => network,
          loadForkNetworkBranches: async () => branches,
          reviewForkBranchCheckout: async (
            _repository,
            catalog,
            _branch,
            localBranchName
          ) => {
            reviews.push({ catalog, localBranchName })
            return plan(localBranchName)
          },
          checkoutReviewedForkBranch: async (_repository, reviewedPlan) => {
            checkouts.push(reviewedPlan)
            return {
              localBranchName: reviewedPlan.localBranchName,
              remoteName: reviewedPlan.remoteName,
              headSha: reviewedPlan.branch.headSha,
              checkoutStarted: true,
            }
          },
        }}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Checkout from another fork…' })
    )
    const forkSelect = await screen.findByRole('combobox', {
      name: 'Fork repository',
    })
    assert(screen.getByText(/reached its safety cap/i))
    fireEvent.change(forkSelect, { target: { value: fork.id } })

    const branchSelect = await screen.findByRole('combobox', {
      name: 'Fork branch',
    })
    fireEvent.change(branchSelect, { target: { value: selectedBranch.id } })
    const localInput = screen.getByRole('textbox', {
      name: 'New local branch',
    }) as HTMLInputElement
    assert.equal(localInput.value, 'fork/alice/feature/review')
    assert(screen.getByText(/1 malformed or unsafe API item/i))

    fireEvent.click(screen.getByRole('button', { name: 'Review checkout' }))
    await screen.findByRole('heading', { name: 'Confirm exact checkout' })
    assert.equal(reviews.length, 1)
    assert.equal(reviews[0].catalog.snapshotToken, branches.snapshotToken)
    assert(screen.getByText(selectedBranch.headSha))
    assert(screen.getByText(plan(localInput.value).remoteRef))

    fireEvent.click(screen.getByRole('button', { name: 'Fetch and checkout' }))
    await waitFor(() => assert.equal(checkouts.length, 1))
    assert.equal(checkouts[0].branch.headSha, selectedBranch.headSha)
    assert.equal(checkouts[0].fork.id, fork.id)
    assert(await screen.findByRole('status'))
  })

  it('offers a non-destructive local-name suggestion after a collision', async () => {
    const repository = new Repository('C:\\repo', 1, null, false)
    render(
      <ForkBranchCheckout
        repository={repository}
        dispatcher={{
          loadForkNetworkRepositories: async () => network,
          loadForkNetworkBranches: async () => branches,
          reviewForkBranchCheckout: async () => {
            throw new ForkBranchCheckoutError(
              'local-branch-collision',
              'fork/alice/feature/review-2'
            )
          },
          checkoutReviewedForkBranch: async () => {
            throw new Error('not expected')
          },
        }}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Checkout from another fork…' })
    )
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'Fork repository' }),
      { target: { value: fork.id } }
    )
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'Fork branch' }),
      { target: { value: selectedBranch.id } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review checkout' }))

    assert(await screen.findByRole('alert'))
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Use suggested branch fork/alice/feature/review-2',
      })
    )
    assert.equal(
      (
        screen.getByRole('textbox', {
          name: 'New local branch',
        }) as HTMLInputElement
      ).value,
      'fork/alice/feature/review-2'
    )
  })

  it('provides Cantonese and compact bilingual copy for the workflow', () => {
    assert.equal(
      translate('forkCheckout.confirm', 'cantonese'),
      'Fetch 並 checkout'
    )
    const bilingual = translate('forkCheckout.errorMoved', 'bilingual')
    assert.match(bilingual, /The fork branch moved after review/)
    assert.match(bilingual, /Fork 分支覆核之後郁咗/)
  })
})
