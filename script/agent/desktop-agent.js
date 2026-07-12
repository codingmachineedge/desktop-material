#!/usr/bin/env node
'use strict'

const { loadConfig } = require('./config')
const { request } = require('./http-client')

function usage() {
  process.stdout.write(`Desktop Material local agent CLI

Usage:
  desktop-agent [--config PATH] info
  desktop-agent [--config PATH] tools
  desktop-agent [--config PATH] call COMMAND [JSON_ARGS]
  desktop-agent [--config PATH] COMMAND [JSON_ARGS]

Examples:
  desktop-agent list-repositories
  desktop-agent get-status '{"repositoryId": 1}'
  desktop-agent push '{"path": "C:\\\\src\\\\project"}'
`)
}

function parseArguments(argv) {
  const args = [...argv]
  let configPath
  const configIndex = args.indexOf('--config')
  if (configIndex >= 0) {
    configPath = args[configIndex + 1]
    args.splice(configIndex, 2)
  }
  return { args, configPath }
}

async function main() {
  const { args, configPath } = parseArguments(process.argv.slice(2))
  const action = args.shift()
  if (action === undefined || action === '--help' || action === '-h') {
    usage()
    return
  }
  const config = loadConfig(configPath)
  let result
  if (action === 'info') {
    result = await request(config, 'GET', '/api/v1/info')
  } else if (action === 'tools') {
    result = await request(config, 'POST', '/mcp', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })
  } else {
    const command = action === 'call' ? args.shift() : action
    if (!command) {
      throw new Error('Missing command name')
    }
    let commandArgs = {}
    if (args[0] !== undefined) {
      try {
        commandArgs = JSON.parse(args[0])
      } catch (_) {
        throw new Error('JSON_ARGS must be a valid JSON object')
      }
      if (
        commandArgs === null ||
        Array.isArray(commandArgs) ||
        typeof commandArgs !== 'object'
      ) {
        throw new Error('JSON_ARGS must be a JSON object')
      }
    }
    result = await request(
      config,
      'POST',
      `/api/v1/command/${encodeURIComponent(command)}`,
      commandArgs
    )
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch(error => {
  // Errors never contain request headers or config contents.
  process.stderr.write(`desktop-agent: ${error.message || 'request failed'}\n`)
  process.exitCode = 1
})
