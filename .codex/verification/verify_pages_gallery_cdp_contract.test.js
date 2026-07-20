'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  acceptedImageDimensions,
  acceptedImageNames,
  assertReceipt,
  geometryExpression,
  responsiveImageDimensions,
} = require('./verify_pages_gallery_cdp.js')

function validReceipt() {
  const acceptedImages = Object.entries(acceptedImageDimensions).map(
    ([file, dimensions]) => ({
      src: `docs/assets/screenshots/${file}`,
      file,
      complete: true,
      naturalWidth: dimensions.width,
      naturalHeight: dimensions.height,
    })
  )
  return {
    documentClientWidth: 960,
    documentScrollWidth: 960,
    bodyClientWidth: 960,
    bodyScrollWidth: 960,
    imageCount: acceptedImages.length,
    figureCount: acceptedImages.length,
    galleryImageCount: acceptedImages.length,
    galleryAssetNames: acceptedImages.map(image => image.file),
    invalidGalleryCards: [],
    brokenImages: [],
    acceptedImages,
    overflow: [],
    outsideControls: [],
  }
}

describe('Pages gallery CDP verifier contracts', () => {
  it('tracks the exact guided gallery at its accepted dimensions', () => {
    assert.equal(acceptedImageNames.length, 68)
    assert.equal(new Set(acceptedImageNames).size, 68)
    assert.equal(Object.keys(acceptedImageDimensions).length, 68)
    assert.deepEqual(acceptedImageDimensions['material-repository-tools.png'], {
      width: 1440,
      height: 960,
    })
    assert.deepEqual(
      acceptedImageDimensions['material-repository-tools-scroll.png'],
      { width: 960, height: 420 }
    )
    assert.deepEqual(acceptedImageDimensions['add-submodule-dialog.png'], {
      width: 1440,
      height: 960,
    })
    assert.deepEqual(Object.keys(responsiveImageDimensions).sort(), [
      'material-repository-tools-scroll.png',
      'material-responsive-overflow-fixed.png',
      'material-scale-200-autofit.png',
      'material-toolbar-overflow.png',
    ])
    for (const file of acceptedImageNames) {
      assert.match(geometryExpression, new RegExp(file.replaceAll('.', '\\.')))
    }
  })

  it('accepts one exact, nonbroken image for every milestone', () => {
    assert.doesNotThrow(() => assertReceipt(validReceipt(), 'contract'))
  })

  it('fails closed when a promoted image has stale dimensions', () => {
    const receipt = validReceipt()
    const image = receipt.acceptedImages.find(value =>
      value.src.endsWith('add-submodule-dialog.png')
    )
    assert.ok(image)
    image.naturalWidth = 1500
    image.naturalHeight = 1032
    assert.throws(() => assertReceipt(receipt, 'contract'), /failed geometry/)
  })

  it('fails closed when a gallery asset is missing or duplicated', () => {
    const missing = validReceipt()
    missing.galleryAssetNames.pop()
    missing.acceptedImages.pop()
    missing.galleryImageCount -= 1
    missing.figureCount -= 1
    assert.throws(() => assertReceipt(missing, 'contract'), /failed geometry/)

    const duplicate = validReceipt()
    duplicate.galleryAssetNames[1] = duplicate.galleryAssetNames[0]
    duplicate.acceptedImages[1] = { ...duplicate.acceptedImages[0] }
    assert.throws(() => assertReceipt(duplicate, 'contract'), /failed geometry/)
  })
})
