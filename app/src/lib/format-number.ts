import {
  getNumberFormatPreference,
  INumberFormat,
} from '../models/formatting-preferences'
import { round } from '../ui/lib/round'
import { enableFormattingPreferences } from './feature-flag'

/**
 * Format a number using the given separator configuration.
 *
 * This is a simple formatter that handles integer and decimal parts with
 * configurable separators. It does not use Intl.NumberFormat.
 *
 * @param value - The number to format
 * @param fmt   - The number format configuration with thousands and decimal
 *                separators, defaults to the user's preferred format.
 */
export function formatNumber(value: number, fmt?: INumberFormat): string {
  if (!fmt && !enableFormattingPreferences()) {
    return value.toString()
  }

  fmt ??= getNumberFormatPreference()

  if (!Number.isFinite(value)) {
    return String(value)
  }

  const isNegative = value < 0
  const abs = Math.abs(value)
  const [intPart, decPart] = abs.toString().split('.')

  // Insert a placeholder character for thousands groupings, then replace with
  // the configured separator. The regex matches positions that are followed by
  // groups of exactly 3 digits.
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\x00')
  const formattedInt = grouped.replace(/\x00/g, fmt.thousandsSeparator)

  const result =
    decPart !== undefined
      ? `${formattedInt}${fmt.decimalSeparator}${decPart}`
      : formattedInt

  return isNegative ? `-${result}` : result
}

export function formatCompactNumber(
  value: number,
  fmt?: INumberFormat
): string {
  if (!fmt && !enableFormattingPreferences()) {
    return `${value}`
  }

  if (!Number.isFinite(value)) {
    return `${value}`
  }

  if (value < 1000) {
    return formatNumber(value, fmt)
  }

  const units = ['', 'k', 'm', 'b', 't']
  const unitIx = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.abs(value)) / Math.log(1000))
  )

  if (unitIx === 0) {
    return formatNumber(value, fmt) + ' ' + units[unitIx]
  }

  const scaled = value / Math.pow(1000, unitIx)
  const decimals = scaled < 10 ? 1 : 0

  const result = round(scaled, decimals)
  return formatNumber(result, fmt) + ' ' + units[unitIx]
}
