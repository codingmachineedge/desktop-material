import assert from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import { LanguageModeStorageKey } from '../../../src/lib/language-preference'
import { confirmAndCancelCheapLfsTransfer } from '../../../src/ui/changes/cheap-lfs-cancel-confirmation'

afterEach(() => {
  localStorage.removeItem(LanguageModeStorageKey)
})

describe('Cheap LFS cancellation confirmation', () => {
  it('leaves the active transfer untouched when cancellation is declined', () => {
    let cancelCount = 0
    let confirmCount = 0

    const cancelled = confirmAndCancelCheapLfsTransfer(
      () => {
        cancelCount++
      },
      message => {
        confirmCount++
        assert.match(message, /^Cancel this Cheap LFS transfer\?/)
        assert.match(message, /pointers in the worktree/)
        return false
      }
    )

    assert.equal(cancelled, false)
    assert.equal(confirmCount, 1)
    assert.equal(cancelCount, 0)
  })

  it('cancels exactly once only after confirmation', () => {
    let cancelCount = 0
    let confirmCount = 0

    const cancelled = confirmAndCancelCheapLfsTransfer(
      () => {
        cancelCount++
      },
      () => {
        confirmCount++
        return true
      }
    )

    assert.equal(cancelled, true)
    assert.equal(confirmCount, 1)
    assert.equal(cancelCount, 1)
  })

  it('uses respectful Cantonese and complete bilingual safety copy', () => {
    const prompts = new Array<string>()

    localStorage.setItem(LanguageModeStorageKey, 'cantonese')
    confirmAndCancelCheapLfsTransfer(
      () => assert.fail('declining must not cancel'),
      message => {
        prompts.push(message)
        return false
      }
    )
    assert.match(prompts[0], /^確定取消今次 Cheap LFS 傳輸？/)
    assert.match(prompts[0], /工作目錄入面已經轉成 pointer 嘅檔案/)
    assert.match(prompts[0], /唔會建立 commit。$/)

    localStorage.setItem(LanguageModeStorageKey, 'bilingual')
    confirmAndCancelCheapLfsTransfer(
      () => assert.fail('declining must not cancel'),
      message => {
        prompts.push(message)
        return false
      }
    )
    assert.match(prompts[1], /^Cancel this Cheap LFS transfer\?/)
    assert.match(prompts[1], / · 確定取消今次 Cheap LFS 傳輸？/)
    assert.match(prompts[1], /唔會建立 commit。$/)
  })
})
