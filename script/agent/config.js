'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function candidates(explicitPath) {
  const values = [
    explicitPath,
    process.env.DESKTOP_MATERIAL_AGENT_CONFIG,
    process.env.GITHUB_DESKTOP_AGENT_CONFIG,
  ]
  if (process.platform === 'win32' && process.env.APPDATA) {
    for (const name of [
      'GitHub Desktop',
      'GitHub Desktop Development',
      'Desktop Material',
      'Desktop Material Development',
    ]) {
      values.push(path.join(process.env.APPDATA, name, 'agent-server.json'))
    }
  } else if (process.platform === 'darwin') {
    for (const name of ['GitHub Desktop', 'GitHub Desktop Development']) {
      values.push(
        path.join(
          os.homedir(),
          'Library',
          'Application Support',
          name,
          'agent-server.json'
        )
      )
    }
  } else {
    const configHome =
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
    values.push(
      path.join(configHome, 'GitHub Desktop', 'agent-server.json'),
      path.join(configHome, 'github-desktop', 'agent-server.json')
    )
  }
  return values.filter(Boolean)
}

function loadConfig(explicitPath) {
  for (const candidate of candidates(explicitPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      if (
        Number.isInteger(parsed.port) &&
        parsed.port > 0 &&
        parsed.port <= 65535 &&
        typeof parsed.token === 'string' &&
        parsed.token.length >= 32
      ) {
        return { port: parsed.port, token: parsed.token, configPath: candidate }
      }
    } catch (_) {
      // Keep searching. Never echo file contents: the file contains a token.
    }
  }
  throw new Error(
    'Agent server config not found. Enable Settings > Agent access, or set DESKTOP_MATERIAL_AGENT_CONFIG.'
  )
}

module.exports = { candidates, loadConfig }
