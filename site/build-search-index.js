#!/usr/bin/env node
'use strict'

/**
 * Builds the GitHub Pages documentation search index.
 *
 * Walks the rendered `_site/docs` tree, extracts each page's title and plain
 * text from its HTML `<main>` body, and writes one `search-index.json` the
 * client-side search page fetches. Text is normalized to single spaces so
 * regular expressions written against prose behave predictably.
 *
 * Usage: node site/build-search-index.js <siteDir>
 */

const fs = require('fs')
const path = require('path')

const siteDir = path.resolve(process.argv[2] ?? '_site')
const docsDir = path.join(siteDir, 'docs')
const MaximumPageCharacters = 200_000

function htmlToText(html) {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  const body = main === null ? html : main[1]
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MaximumPageCharacters)
}

function titleOf(html, fallback) {
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (heading !== null) {
    const text = htmlToText(`<main>${heading[1]}</main>`)
    if (text !== '') {
      return text
    }
  }
  const tag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (tag !== null) {
    return tag[1].replace(/\s*·\s*Desktop Material Docs\s*$/, '').trim()
  }
  return fallback
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      yield full
    }
  }
}

function main() {
  if (!fs.existsSync(docsDir)) {
    throw new Error(`Rendered documentation directory is missing: ${docsDir}`)
  }

  const pages = []
  for (const file of walk(docsDir)) {
    const relative = path.relative(docsDir, file).split(path.sep).join('/')
    if (relative === 'search.html') {
      continue
    }
    const html = fs.readFileSync(file, 'utf8')
    const text = htmlToText(html)
    if (text === '') {
      continue
    }
    pages.push({
      url: relative,
      path: relative
        .replace(/(?:^|\/)index\.html$/, '/')
        .replace(/\.html$/, ''),
      title: titleOf(html, relative),
      text,
    })
  }

  pages.sort((left, right) => left.url.localeCompare(right.url))
  const out = path.join(docsDir, 'search-index.json')
  fs.writeFileSync(out, JSON.stringify({ pages }))
  process.stdout.write(
    `Indexed ${pages.length} documentation pages into ${out}\n`
  )
}

main()
