#!/usr/bin/env node
'use strict'

const readline = require('readline')
const { loadConfig } = require('./config')
const { request } = require('./http-client')

const configIndex = process.argv.indexOf('--config')
const explicitConfig =
  configIndex >= 0 ? process.argv[configIndex + 1] : undefined
const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})
let chain = Promise.resolve()

function errorResponse(id, message) {
  return {
    jsonrpc: '2.0',
    id: id === undefined ? null : id,
    error: { code: -32000, message },
  }
}

async function forward(line) {
  if (Buffer.byteLength(line) > 64 * 1024) {
    process.stdout.write(
      `${JSON.stringify(errorResponse(null, 'Request exceeds 64 KiB'))}\n`
    )
    return
  }
  let message
  try {
    message = JSON.parse(line)
  } catch (_) {
    process.stdout.write(
      `${JSON.stringify(errorResponse(null, 'Invalid JSON'))}\n`
    )
    return
  }

  try {
    // Reload on every call so token rotation takes effect without restarting the client.
    const response = await request(
      loadConfig(explicitConfig),
      'POST',
      '/mcp',
      message
    )
    if (response !== undefined) {
      process.stdout.write(`${JSON.stringify(response)}\n`)
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify(
        errorResponse(message && message.id, error.message || 'Proxy error')
      )}\n`
    )
  }
}

input.on('line', line => {
  if (line.trim().length === 0) {
    return
  }
  chain = chain.then(() => forward(line))
})

input.on('close', () => {
  chain.catch(() => {}).finally(() => process.exit(0))
})
