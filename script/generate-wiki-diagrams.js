const fs = require('fs')
const path = require('path')

const outDir = path.resolve(__dirname, '../docs/assets/diagrams')
fs.mkdirSync(outDir, { recursive: true })

const diagrams = [
  ['wiki-map', 'Choose the right guide', ['Start here', 'Learn daily Git', 'Explore features', 'Go deeper'], ['Home', 'User Guide', 'Feature Gallery', 'Specialist guides']],
  ['workspace-loop', 'The everyday repository loop', ['Inspect changes', 'Stage deliberately', 'Commit locally', 'Sync safely'], ['Review the diff', 'Choose exact files', 'Create a checkpoint', 'Pull then push']],
  ['feature-gallery-map', 'From goal to guided feature', ['Find a capability', 'Open its surface', 'Review context', 'Complete safely'], ['Browse by workflow', 'Use the named tool', 'Confirm scope', 'Keep evidence']],
  ['renderer-state-flow', 'One-way application state', ['React UI', 'Dispatcher', 'AppStore', 'Fresh state'], ['Send an intent', 'Validate and route', 'Perform the work', 'Render the result']],
  ['automation-safety-gates', 'Automation runs only when safe', ['Scheduled trigger', 'Repository checks', 'Bounded action', 'Audit trail'], ['Selected repo only', 'Skip unsafe states', 'Never force', 'Record the outcome']],
  ['agent-request-path', 'Every agent request crosses the same gates', ['Local client', 'Loopback server', 'Command executor', 'Store and Git'], ['Token required', 'Schema and limits', 'Resolve exact repo', 'Use app safeguards']],
  ['regex-builder-flow', 'Build and test a search pattern', ['Pick building blocks', 'Compose pattern', 'Test examples', 'Apply to search'], ['Anchors and classes', 'Groups and repeats', 'Fix invalid input', 'Filter live results']],
  ['submodule-state-path', 'A submodule moves through known states', ['Declared', 'Initialized', 'Synchronized', 'Updated'], ['Listed in .gitmodules', 'Repository cloned', 'Remote copied', 'Pinned commit checked out']],
]

const escape = value => value.replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])

function render(title, stages, details) {
  const cards = stages.map((stage, index) => {
    const x = 48 + index * 360
    const number = index + 1
    const arrow = index < stages.length - 1
      ? `<path d="M ${x + 278} 260 H ${x + 338}" stroke="#57c7ff" stroke-width="8" stroke-linecap="round"/><path d="M ${x + 326} 246 L ${x + 342} 260 L ${x + 326} 274" fill="none" stroke="#57c7ff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
      : ''
    return `<g>
      <rect x="${x}" y="142" width="278" height="236" rx="30" fill="#ffffff" stroke="#cbd5e1" stroke-width="4"/>
      <circle cx="${x + 42}" cy="188" r="24" fill="${index === stages.length - 1 ? '#16a34a' : '#1267d6'}"/>
      <text x="${x + 42}" y="197" text-anchor="middle" font-size="25" font-weight="700" fill="#ffffff">${number}</text>
      <text x="${x + 28}" y="252" font-size="27" font-weight="700" fill="#10233f">${escape(stage)}</text>
      <text x="${x + 28}" y="304" font-size="21" fill="#475569">${escape(details[index])}</text>
      <rect x="${x + 28}" y="330" width="222" height="10" rx="5" fill="${index === stages.length - 1 ? '#86efac' : '#bae6fd'}"/>
      ${arrow}
    </g>`
  }).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="512" viewBox="0 0 1536 512" role="img" aria-labelledby="title desc">
  <title id="title">${escape(title)}</title>
  <desc id="desc">${escape(stages.join(' then '))}</desc>
  <rect width="1536" height="512" rx="40" fill="#f8fafc"/>
  <rect x="2" y="2" width="1532" height="508" rx="38" fill="none" stroke="#cbd5e1" stroke-width="4"/>
  <text x="48" y="80" font-family="Segoe UI, Arial, sans-serif" font-size="42" font-weight="750" fill="#10233f">${escape(title)}</text>
  <path d="M 48 104 H 1488" stroke="#dbe3ed" stroke-width="3"/>
  <g font-family="Segoe UI, Arial, sans-serif">${cards}</g>
</svg>\n`
}

for (const [name, title, stages, details] of diagrams) {
  fs.writeFileSync(path.join(outDir, `${name}.svg`), render(title, stages, details))
}

console.log(`Generated ${diagrams.length} wiki diagrams in ${outDir}`)
