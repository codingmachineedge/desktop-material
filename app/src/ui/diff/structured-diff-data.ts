import * as Path from 'path'

export const MaxStructuredDiffBytes = 512 * 1024
export const MaxStructuredDiffRows = 500
export const MaxStructuredDiffColumns = 128
export const MaxStructuredDiffCells = 20_000
export const MaxStructuredDiffCellCharacters = 64 * 1024

export type StructuredDiffFormat = 'csv' | 'tsv'
export type StructuredDiffStatus = 'unchanged' | 'added' | 'removed' | 'changed'

export interface IStructuredDiffCell {
  readonly status: StructuredDiffStatus
  readonly previous?: string
  readonly current?: string
}

export interface IStructuredDiffRow {
  readonly status: StructuredDiffStatus
  readonly previousRowNumber?: number
  readonly currentRowNumber?: number
  readonly cells: ReadonlyArray<IStructuredDiffCell>
}

export interface IStructuredDiffData {
  readonly format: StructuredDiffFormat
  readonly columnCount: number
  readonly rows: ReadonlyArray<IStructuredDiffRow>
}

export type StructuredDiffFallbackReason =
  | 'unsupported'
  | 'malformed'
  | 'oversized'
  | 'empty'

export type StructuredDiffBuildResult =
  | { readonly kind: 'table'; readonly data: IStructuredDiffData }
  | { readonly kind: 'code'; readonly reason: StructuredDiffFallbackReason }

type DelimitedTextParseResult =
  | {
      readonly kind: 'parsed'
      readonly rows: ReadonlyArray<ReadonlyArray<string>>
    }
  | { readonly kind: 'fallback'; readonly reason: 'malformed' | 'oversized' }

/** Parse RFC-4180 quoting and record rules with hard resource limits. */
export function parseDelimitedText(
  text: string,
  delimiter: ',' | '\t'
): DelimitedTextParseResult {
  if (Buffer.byteLength(text, 'utf8') > MaxStructuredDiffBytes) {
    return { kind: 'fallback', reason: 'oversized' }
  }

  const rows = new Array<ReadonlyArray<string>>()
  let row = new Array<string>()
  let field = ''
  let inQuotes = false
  let afterQuote = false
  let fieldStarted = false
  let recordStarted = false
  let cellCount = 0

  const append = (value: string) => {
    field += value
    if (field.length > MaxStructuredDiffCellCharacters) {
      return false
    }
    fieldStarted = true
    recordStarted = true
    return true
  }

  const pushField = () => {
    row.push(field)
    cellCount++
    field = ''
    fieldStarted = false
    afterQuote = false
    return (
      row.length <= MaxStructuredDiffColumns &&
      cellCount <= MaxStructuredDiffCells
    )
  }

  const pushRow = () => {
    rows.push(row)
    row = []
    recordStarted = false
    return rows.length <= MaxStructuredDiffRows
  }

  for (let index = 0; index < text.length; index++) {
    const character = text[index]

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          if (!append('"')) {
            return { kind: 'fallback', reason: 'oversized' }
          }
          index++
        } else {
          inQuotes = false
          afterQuote = true
        }
      } else if (!append(character)) {
        return { kind: 'fallback', reason: 'oversized' }
      }
      continue
    }

    const isNewline = character === '\r' || character === '\n'
    if (afterQuote) {
      if (character === delimiter) {
        if (!pushField()) {
          return { kind: 'fallback', reason: 'oversized' }
        }
        recordStarted = true
      } else if (isNewline) {
        if (!pushField() || !pushRow()) {
          return { kind: 'fallback', reason: 'oversized' }
        }
        if (character === '\r' && text[index + 1] === '\n') {
          index++
        }
      } else {
        return { kind: 'fallback', reason: 'malformed' }
      }
      continue
    }

    if (character === '"') {
      if (fieldStarted) {
        return { kind: 'fallback', reason: 'malformed' }
      }
      inQuotes = true
      fieldStarted = true
      recordStarted = true
    } else if (character === delimiter) {
      if (!pushField()) {
        return { kind: 'fallback', reason: 'oversized' }
      }
      recordStarted = true
    } else if (isNewline) {
      if (!pushField() || !pushRow()) {
        return { kind: 'fallback', reason: 'oversized' }
      }
      if (character === '\r' && text[index + 1] === '\n') {
        index++
      }
    } else if (!append(character)) {
      return { kind: 'fallback', reason: 'oversized' }
    }
  }

  if (inQuotes) {
    return { kind: 'fallback', reason: 'malformed' }
  }

  if (afterQuote || fieldStarted || row.length > 0 || recordStarted) {
    if (!pushField() || !pushRow()) {
      return { kind: 'fallback', reason: 'oversized' }
    }
  }

  return { kind: 'parsed', rows }
}

interface IAlignedRow {
  readonly status: StructuredDiffStatus
  readonly previous?: ReadonlyArray<string>
  readonly current?: ReadonlyArray<string>
  readonly previousRowNumber?: number
  readonly currentRowNumber?: number
}

function alignRows(
  previousRows: ReadonlyArray<ReadonlyArray<string>>,
  currentRows: ReadonlyArray<ReadonlyArray<string>>
): ReadonlyArray<IAlignedRow> {
  const previousSignatures = previousRows.map(row => JSON.stringify(row))
  const currentSignatures = currentRows.map(row => JSON.stringify(row))
  const width = currentRows.length + 1
  const lcs = new Uint16Array((previousRows.length + 1) * width)

  for (let previous = previousRows.length - 1; previous >= 0; previous--) {
    for (let current = currentRows.length - 1; current >= 0; current--) {
      const offset = previous * width + current
      lcs[offset] =
        previousSignatures[previous] === currentSignatures[current]
          ? lcs[(previous + 1) * width + current + 1] + 1
          : Math.max(
              lcs[(previous + 1) * width + current],
              lcs[previous * width + current + 1]
            )
    }
  }

  const operations = new Array<IAlignedRow>()
  let previous = 0
  let current = 0
  while (previous < previousRows.length && current < currentRows.length) {
    if (previousSignatures[previous] === currentSignatures[current]) {
      operations.push({
        status: 'unchanged',
        previous: previousRows[previous],
        current: currentRows[current],
        previousRowNumber: previous + 1,
        currentRowNumber: current + 1,
      })
      previous++
      current++
    } else if (
      lcs[(previous + 1) * width + current] >=
      lcs[previous * width + current + 1]
    ) {
      operations.push({
        status: 'removed',
        previous: previousRows[previous],
        previousRowNumber: previous + 1,
      })
      previous++
    } else {
      operations.push({
        status: 'added',
        current: currentRows[current],
        currentRowNumber: current + 1,
      })
      current++
    }
  }

  while (previous < previousRows.length) {
    operations.push({
      status: 'removed',
      previous: previousRows[previous],
      previousRowNumber: previous + 1,
    })
    previous++
  }
  while (current < currentRows.length) {
    operations.push({
      status: 'added',
      current: currentRows[current],
      currentRowNumber: current + 1,
    })
    current++
  }

  const aligned = new Array<IAlignedRow>()
  for (let index = 0; index < operations.length; ) {
    if (operations[index].status === 'unchanged') {
      aligned.push(operations[index++])
      continue
    }

    const removed = new Array<IAlignedRow>()
    const added = new Array<IAlignedRow>()
    while (
      index < operations.length &&
      operations[index].status !== 'unchanged'
    ) {
      const operation = operations[index++]
      if (operation.status === 'removed') {
        removed.push(operation)
      } else {
        added.push(operation)
      }
    }

    const paired = Math.min(removed.length, added.length)
    for (let pair = 0; pair < paired; pair++) {
      aligned.push({
        status: 'changed',
        previous: removed[pair].previous,
        current: added[pair].current,
        previousRowNumber: removed[pair].previousRowNumber,
        currentRowNumber: added[pair].currentRowNumber,
      })
    }
    aligned.push(...removed.slice(paired), ...added.slice(paired))
  }

  return aligned
}

function buildCells(
  row: IAlignedRow,
  columnCount: number
): ReadonlyArray<IStructuredDiffCell> {
  const cells = new Array<IStructuredDiffCell>()
  for (let column = 0; column < columnCount; column++) {
    const hasPrevious =
      row.previous !== undefined && column < row.previous.length
    const hasCurrent = row.current !== undefined && column < row.current.length
    const previous = hasPrevious ? row.previous?.[column] : undefined
    const current = hasCurrent ? row.current?.[column] : undefined
    let status: StructuredDiffStatus = 'unchanged'

    if (hasPrevious && !hasCurrent) {
      status = 'removed'
    } else if (!hasPrevious && hasCurrent) {
      status = 'added'
    } else if (previous !== current) {
      status = 'changed'
    } else if (row.status === 'added' && hasCurrent) {
      status = 'added'
    } else if (row.status === 'removed' && hasPrevious) {
      status = 'removed'
    }

    cells.push({ status, previous, current })
  }
  return cells
}

/** Build a row/cell diff, or explicitly choose the ordinary code fallback. */
export function buildStructuredDiff(
  path: string,
  previousText: string,
  currentText: string
): StructuredDiffBuildResult {
  const extension = Path.extname(path).toLowerCase()
  const format =
    extension === '.csv' ? 'csv' : extension === '.tsv' ? 'tsv' : null
  if (format === null) {
    return { kind: 'code', reason: 'unsupported' }
  }

  const delimiter = format === 'csv' ? ',' : '\t'
  const previous = parseDelimitedText(previousText, delimiter)
  const current = parseDelimitedText(currentText, delimiter)
  if (previous.kind === 'fallback' || current.kind === 'fallback') {
    const reason =
      previous.kind === 'fallback' && previous.reason === 'oversized'
        ? 'oversized'
        : current.kind === 'fallback' && current.reason === 'oversized'
        ? 'oversized'
        : 'malformed'
    return { kind: 'code', reason }
  }
  if (previous.rows.length === 0 && current.rows.length === 0) {
    return { kind: 'code', reason: 'empty' }
  }

  const allRows = [...previous.rows, ...current.rows]
  const columnCount = allRows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0
  )
  if (columnCount === 0) {
    return { kind: 'code', reason: 'empty' }
  }

  const rows = alignRows(previous.rows, current.rows).map(row => ({
    status: row.status,
    previousRowNumber: row.previousRowNumber,
    currentRowNumber: row.currentRowNumber,
    cells: buildCells(row, columnCount),
  }))

  return { kind: 'table', data: { format, columnCount, rows } }
}
