#!/usr/bin/env node
'use strict'

/**
 * Bounded CDP verifier for the isolated GitHub API Explorer production gate.
 * It connects only to an explicitly supplied loopback port and never launches,
 * resizes, focuses, or terminates Electron itself.
 */

const {
  CDPClient,
  capture,
  clickButton,
  evaluate,
  fail,
  getJSON,
  seedIsolatedProfile,
  validateCapturePath,
  waitFor,
} = require('./verify_actions_pagination_cdp')

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) {
      fail(`Invalid argument near ${name ?? '<end>'}.`)
    }
    values.set(name.slice(2), value)
  }

  const port = Number(values.get('port'))
  const windowWidth = Number(values.get('window-width'))
  const windowHeight = Number(values.get('window-height'))
  const providerEndpoint = values.get('provider-endpoint')
  const accountLogin = values.get('account-login')
  const accountId = Number(values.get('account-id'))
  let parsedEndpoint
  try {
    parsedEndpoint = new URL(providerEndpoint)
  } catch {
    fail('A valid fixture provider endpoint is required.')
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('A valid loopback CDP port is required.')
  }
  if (
    !Number.isSafeInteger(windowWidth) ||
    !Number.isSafeInteger(windowHeight) ||
    windowWidth < 800 ||
    windowWidth > 3000 ||
    windowHeight < 600 ||
    windowHeight > 2200
  ) {
    fail('Bounded window dimensions are required.')
  }
  if (
    parsedEndpoint.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1'].includes(
      parsedEndpoint.hostname.toLowerCase()
    ) ||
    parsedEndpoint.pathname.replace(/\/$/, '') !== '/api/v3' ||
    parsedEndpoint.username !== '' ||
    parsedEndpoint.password !== ''
  ) {
    fail('The fixture provider must be an uncredentialed loopback /api/v3 URL.')
  }
  if (!/^[A-Za-z0-9-]{1,39}$/.test(accountLogin ?? '')) {
    fail('A valid fixture account login is required.')
  }
  if (!Number.isSafeInteger(accountId) || accountId < 1) {
    fail('A valid fixture account id is required.')
  }

  return {
    port,
    windowWidth,
    windowHeight,
    capturePath: validateCapturePath(values.get('capture'), 'capture'),
    functionsCapturePath:
      values.get('functions-capture') === undefined
        ? null
        : validateCapturePath(
            values.get('functions-capture'),
            'functions-capture'
          ),
    fixtureAccount: {
      endpoint: parsedEndpoint.toString().replace(/\/$/, ''),
      login: accountLogin,
      id: accountId,
    },
  }
}

const geometryExpression = `(() => {
  const round = value => Math.round(value * 100) / 100
  const label = element => {
    const text = (element.getAttribute('aria-label') || element.textContent || '').trim()
    return (element.id ? '#' + element.id : element.className?.toString() || element.tagName) +
      (text ? ':' + text.slice(0, 90) : '')
  }
  const root = document.querySelector('.github-api-explorer')
  const layout = document.querySelector('.github-api-explorer-layout')
  const catalog = document.querySelector('.github-api-explorer-catalog')
  const builder = document.querySelector('.github-api-explorer-builder')
  const response = document.querySelector('.github-api-explorer-response')
  const overflow = []
  for (const selector of [
    '.github-api-explorer',
    '.github-api-explorer-layout',
    '.github-api-explorer-catalog',
    '.github-api-explorer-operation-list',
    '.github-api-explorer-builder',
    '.github-api-explorer-form',
    '.github-api-explorer-rest-target',
    '.github-api-explorer-operation-summary',
    '.github-api-explorer-response'
  ]) {
    for (const element of document.querySelectorAll(selector)) {
      if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) {
        overflow.push({ element: label(element), client: element.clientWidth, scroll: element.scrollWidth })
      }
    }
  }
  const outside = []
  for (const element of [root, layout, catalog, builder].filter(Boolean)) {
    const rect = element.getBoundingClientRect()
    if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) {
      outside.push({
        element: label(element),
        left: round(rect.left), right: round(rect.right),
        top: round(rect.top), bottom: round(rect.bottom)
      })
    }
  }
  const selected = document.querySelector('.github-api-explorer-operation-list button[aria-pressed="true"]')
  const ancestors = []
  for (let element = root; element && ancestors.length < 6; element = element.parentElement) {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    ancestors.push({
      element: label(element),
      top: round(rect.top), bottom: round(rect.bottom), height: round(rect.height),
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
      display: style.display, overflowY: style.overflowY,
      flex: style.flex, minHeight: style.minHeight, heightStyle: style.height
    })
  }
  return {
    innerWidth,
    innerHeight,
    devicePixelRatio,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rootPresent: root !== null,
    catalogCount: document.querySelector('.github-api-explorer-catalog header > span')?.textContent.trim() || null,
    operationCount: document.querySelectorAll('.github-api-explorer-operation-list > li').length,
    newBadgeCount: [...document.querySelectorAll('.github-api-explorer-operation-heading em')]
      .filter(value => value.textContent.trim() === 'New').length,
    selectedOperation: selected?.getAttribute('aria-label') || null,
    method: document.querySelector('select[aria-label="REST method"]')?.value ||
      [...document.querySelectorAll('label')].find(value => value.firstChild?.textContent?.trim() === 'REST method')?.querySelector('select')?.value || null,
    path: [...document.querySelectorAll('label')]
      .find(value => value.firstChild?.textContent?.trim() === 'REST API path')?.querySelector('input')?.value || null,
    responseStatus: response?.querySelector('header strong')?.textContent.trim() || null,
    responseHasFirstPattern: response?.textContent.includes('Material production credential') || false,
    responseHasLongPattern: response?.textContent.includes('Long synthetic release signing identity for responsive Explorer verification') || false,
    functionCount: document.querySelectorAll('.github-api-functions li').length,
    functionNames: [...document.querySelectorAll('.github-api-functions li strong')].map(value => value.textContent.trim()),
    functionMessage: document.querySelector('.github-api-functions .github-api-explorer-message')?.textContent.trim() || null,
    errorText: document.querySelector('.github-api-explorer-error')?.textContent.trim() || null,
    ancestors,
    overflow,
    outside
  }
})()`

function assertGeometry(receipt) {
  const failures = []
  if (receipt.documentScrollWidth !== receipt.documentClientWidth) {
    failures.push('document width')
  }
  if (receipt.bodyScrollWidth !== receipt.bodyClientWidth) {
    failures.push('body width')
  }
  if (!receipt.rootPresent) failures.push('Explorer root')
  if (receipt.overflow.length > 0) failures.push('horizontal overflow')
  if (receipt.outside.length > 0) failures.push('viewport containment')
  if (failures.length > 0) {
    fail(
      `Geometry gate failed (${failures.join(', ')}): ${JSON.stringify(
        receipt
      )}`
    )
  }
}

async function interact(client, options) {
  if (await seedIsolatedProfile(client, options.fixtureAccount)) {
    fail(
      'Initialized the isolated verification profile; restart the exact app with the same profile before retrying.'
    )
  }

  await evaluate(
    client,
    `(() => { window.resizeTo(${options.windowWidth}, ${options.windowHeight}); return true })()`
  )
  await new Promise(resolve => setTimeout(resolve, 500))
  const dimensions = await evaluate(
    client,
    `({
      innerWidth,
      innerHeight,
      outerWidth,
      outerHeight,
      devicePixelRatio,
      physicalClientWidth: Math.round(innerWidth * devicePixelRatio),
      physicalClientHeight: Math.round(innerHeight * devicePixelRatio)
    })`
  )
  if (
    Math.abs(dimensions.physicalClientWidth - options.windowWidth) > 1 ||
    Math.abs(dimensions.physicalClientHeight - options.windowHeight) > 1
  ) {
    fail(
      `Exact client dimensions were not applied: ${JSON.stringify(dimensions)}`
    )
  }

  await waitFor(
    client,
    `document.querySelector('#github-api-tab') !== null || [...document.querySelectorAll('button')].some(value => (value.textContent.trim() === 'Add repository' || value.textContent.trim().startsWith('Fetch origin')) && !value.disabled)`,
    'app shell or Add local repository confirmation'
  )
  if (
    await evaluate(
      client,
      `[...document.querySelectorAll('button')].some(value => value.textContent.trim() === 'Add repository' && !value.disabled)`
    )
  ) {
    await clickButton(client, 'Add repository')
  }
  if (
    !(await evaluate(
      client,
      `document.querySelector('#github-api-tab') !== null`
    ))
  ) {
    await waitFor(
      client,
      `[...document.querySelectorAll('button')].some(value => value.textContent.trim().startsWith('Fetch origin') && !value.disabled)`,
      'Fetch origin association action'
    )
    const clicked = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find(value => value.textContent.trim().startsWith('Fetch origin') && !value.disabled)
        if (!button) return false
        button.click()
        return true
      })()`
    )
    if (!clicked) fail('Unable to activate Fetch origin.')
  }

  await waitFor(
    client,
    `document.querySelector('#github-api-tab') !== null`,
    'GitHub API tab'
  )
  await evaluate(client, `document.querySelector('#github-api-tab').click()`)
  await waitFor(
    client,
    `document.querySelector('.github-api-explorer h1')?.textContent.trim() === 'GitHub API Explorer'`,
    'GitHub API Explorer'
  )
  await waitFor(
    client,
    `document.querySelector('.github-api-explorer-catalog header > span')?.textContent.trim() === '10 of 10 shown' && document.querySelectorAll('.github-api-explorer-operation-list > li').length === 10`,
    'exact new-operation catalog'
  )

  const initial = await evaluate(client, geometryExpression)
  if (
    initial.catalogCount !== '10 of 10 shown' ||
    initial.operationCount !== 10 ||
    initial.newBadgeCount !== 10 ||
    !initial.selectedOperation?.startsWith(
      'GET List repository custom patterns'
    ) ||
    initial.method !== 'GET' ||
    initial.path !==
      'repos/material-fixture-owner/material-fixture/secret-scanning/custom-patterns'
  ) {
    fail(`Explorer catalog state was unexpected: ${JSON.stringify(initial)}`)
  }

  await clickButton(client, 'Run request')
  await waitFor(
    client,
    `document.querySelector('.github-api-explorer-response header strong')?.textContent.trim() === '200 OK' && document.querySelector('.github-api-explorer-response pre')?.textContent.includes('Material production credential') && document.querySelector('.github-api-explorer-response pre')?.textContent.includes('Long synthetic release signing identity for responsive Explorer verification')`,
    'synthetic custom-pattern response'
  )
  await evaluate(
    client,
    `(() => {
      document.querySelector('.github-api-explorer-operation-list button[aria-pressed="true"]')
        .scrollIntoView({ block: 'center', inline: 'nearest' })
      document.querySelector('.github-api-explorer-response')
        .scrollIntoView({ block: 'nearest', inline: 'nearest' })
      return true
    })()`
  )
  await new Promise(resolve => setTimeout(resolve, 300))

  const receipt = await evaluate(client, geometryExpression)
  assertGeometry(receipt)
  if (
    receipt.catalogCount !== '10 of 10 shown' ||
    receipt.operationCount !== 10 ||
    receipt.newBadgeCount !== 10 ||
    receipt.responseStatus !== '200 OK' ||
    !receipt.responseHasFirstPattern ||
    !receipt.responseHasLongPattern ||
    receipt.errorText !== null
  ) {
    fail(`Explorer response state was unexpected: ${JSON.stringify(receipt)}`)
  }
  const bodyText = await evaluate(
    client,
    `(document.body?.innerText || '').toLowerCase()`
  )
  for (const forbidden of [
    'fixture-secret',
    'bearer ',
    'authorization:',
    'set-cookie',
  ]) {
    if (bodyText.includes(forbidden)) {
      fail(`Forbidden credential material was visible: ${forbidden}`)
    }
  }

  const captureBytes = await capture(client, options.capturePath)

  const functionName = 'list_material_patterns'
  const functionDescription =
    'List the bounded custom-pattern fixture through the app catalog'
  const functionDescriptionUpdated = `${functionDescription} (verified)`
  const filled = await evaluate(
    client,
    `(() => {
      const setValue = (labelText, value) => {
        const label = [...document.querySelectorAll('.github-api-function-editor label')]
          .find(candidate => candidate.textContent.includes(labelText))
        const input = label?.querySelector('input')
        if (!(input instanceof HTMLInputElement)) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }
      return setValue('Function name', ${JSON.stringify(functionName)}) &&
        setValue('Function description', ${JSON.stringify(functionDescription)})
    })()`
  )
  if (!filled) fail('Unable to fill the app-function editor.')
  await clickButton(client, 'Add current request as function')
  await waitFor(
    client,
    `[...document.querySelectorAll('.github-api-functions li strong')].some(value => value.textContent.trim() === ${JSON.stringify(
      functionName
    )})`,
    'named app function creation'
  )

  await clickButton(client, 'Run function')
  await waitFor(
    client,
    `document.querySelector('.github-api-explorer-response header strong')?.textContent.trim() === '200 OK' && document.querySelector('.github-api-functions .github-api-explorer-message')?.textContent.includes(${JSON.stringify(
      functionName
    )})`,
    'named app function execution'
  )

  await clickButton(client, 'Edit')
  const edited = await evaluate(
    client,
    `(() => {
      const label = [...document.querySelectorAll('.github-api-function-editor label')]
        .find(candidate => candidate.textContent.includes('Function description'))
      const input = label?.querySelector('input')
      if (!(input instanceof HTMLInputElement)) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter.call(input, ${JSON.stringify(functionDescriptionUpdated)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`
  )
  if (!edited) fail('Unable to edit the app-function description.')
  await clickButton(client, 'Update function from current request')
  await waitFor(
    client,
    `[...document.querySelectorAll('.github-api-functions li')].some(value => value.textContent.includes(${JSON.stringify(
      functionDescriptionUpdated
    )}))`,
    'named app function update'
  )

  await evaluate(
    client,
    `(() => {
      const panel = document.querySelector('.github-api-functions')
      panel?.scrollIntoView({ block: 'start', inline: 'nearest' })
      return panel !== null
    })()`
  )
  await new Promise(resolve => setTimeout(resolve, 300))
  const functionReceipt = await evaluate(client, geometryExpression)
  assertGeometry(functionReceipt)
  if (
    functionReceipt.functionCount !== 1 ||
    !functionReceipt.functionNames.includes(functionName) ||
    functionReceipt.errorText !== null
  ) {
    fail(
      `App-function state was unexpected: ${JSON.stringify(functionReceipt)}`
    )
  }
  const functionsCaptureBytes =
    options.functionsCapturePath === null
      ? null
      : await capture(client, options.functionsCapturePath)

  await clickButton(client, 'Remove')
  await waitFor(
    client,
    `document.querySelectorAll('.github-api-functions li').length === 0 && !document.querySelector('.github-api-functions')?.textContent.includes(${JSON.stringify(
      functionName
    )}) && (document.querySelector('.github-api-functions .github-api-explorer-message')?.textContent.includes('removed from the catalog') || document.querySelector('.github-api-functions-unavailable')?.textContent.includes('No functions yet'))`,
    'named app function removal'
  )

  return {
    receipt,
    captureBytes,
    functionReceipt,
    functionsCaptureBytes,
    functionRemoved: true,
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const targets = await getJSON(options.port, '/json/list')
  const target = targets.find(
    value => value.type === 'page' && value.webSocketDebuggerUrl
  )
  if (target === undefined) {
    fail('No renderer page target was exposed on the owned CDP port.')
  }
  const client = new CDPClient(target.webSocketDebuggerUrl)
  await client.open()
  try {
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    const result = await interact(client, options)
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`)
  } finally {
    client.close()
  }
}

main().catch(error => {
  process.stderr.write(
    `${error?.stack || error?.message || String(error ?? 'Unknown error.')}\n`
  )
  process.exitCode = 1
})
