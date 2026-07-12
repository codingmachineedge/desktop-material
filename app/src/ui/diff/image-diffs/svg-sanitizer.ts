import DOMPurify from 'dompurify'

const ForbiddenTags = [
  'script',
  'foreignObject',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
]

const URLAttributes = new Set(['href', 'xlink:href', 'src'])

function isSafeReference(value: string) {
  const normalized = value.trim().replaceAll(/\s+/g, '')
  return (
    normalized.startsWith('#') ||
    /^data:image\/(?:png|gif|jpe?g|webp);base64,/i.test(normalized)
  )
}

/**
 * Sanitizes untrusted repository SVG before it is encoded into an image data
 * URL. Active content, embedded HTML, CSS, and external resource references
 * are removed; local fragment references and embedded raster images remain.
 */
export function sanitizeSVG(source: string): string {
  const sanitized = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ForbiddenTags,
    FORBID_ATTR: ['style'],
  })
  const document = new DOMParser().parseFromString(sanitized, 'image/svg+xml')

  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value

      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
      } else if (URLAttributes.has(name) && !isSafeReference(value)) {
        element.removeAttribute(attribute.name)
      } else if (/url\s*\(/i.test(value)) {
        const references = [...value.matchAll(/url\s*\(([^)]+)\)/gi)]
        if (
          references.some(
            match => !isSafeReference(match[1].replace(/^['"]|['"]$/g, ''))
          )
        ) {
          element.removeAttribute(attribute.name)
        }
      }
    }
  }

  const root = document.documentElement
  return root.localName === 'svg' ? root.outerHTML : ''
}
