'use strict'

const http = require('http')

function request(config, method, requestPath, value) {
  const body = value === undefined ? undefined : JSON.stringify(value)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: config.port,
        path: requestPath,
        method,
        timeout: 70000,
        headers: {
          Authorization: `Bearer ${config.token}`,
          Connection: 'close',
          ...(body === undefined
            ? {}
            : {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }),
        },
      },
      response => {
        const chunks = []
        let size = 0
        response.on('data', chunk => {
          size += chunk.length
          if (size <= 1024 * 1024) {
            chunks.push(chunk)
          }
        })
        response.on('end', () => {
          if (size > 1024 * 1024) {
            reject(new Error('Agent response exceeded 1 MiB'))
            return
          }
          const text = Buffer.concat(chunks).toString('utf8')
          let result
          try {
            result = text.length === 0 ? undefined : JSON.parse(text)
          } catch (_) {
            reject(
              new Error(
                `Agent server returned invalid JSON (HTTP ${response.statusCode})`
              )
            )
            return
          }
          if ((response.statusCode || 500) >= 400) {
            const message = result && result.error && result.error.message
            reject(
              new Error(
                message || `Agent server returned HTTP ${response.statusCode}`
              )
            )
            return
          }
          resolve(result)
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('Agent request timed out')))
    req.on('error', reject)
    req.end(body)
  })
}

module.exports = { request }
