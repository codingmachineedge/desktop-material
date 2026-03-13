import { getNumberFormatPreference } from '../models/formatting-preferences'

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
export function formatNumber(
  value: number,
  fmt = getNumberFormatPreference()
): string {
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
