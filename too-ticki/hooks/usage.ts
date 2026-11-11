import type { SessionUsage } from 'claude-code'

// The usage panel on the right of the band: context window, session (5-hour)
// and weekly limits, laid out like the desktop app's own usage popover.

export const INFO_W = 300

export type Row = { label: string; short: string; note: string; value: string; percent: number }

const tokens = (n: number): string =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

// "Nullstilles om 4 t 23 min" within a day, else "Nullstilles fre. 12:00".
function resets(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const mins = Math.max(0, Math.round((at - now) / 60_000))
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `Nullstilles om ${h ? `${h} t ` : ''}${m} min`
  }
  return `Nullstilles ${new Date(at).toLocaleString('nb-NO', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
}

// The context window is her scent trail; the 5-hour limit is one walk.
const LIMITS: Record<string, [string, string]> = { five_hour: ['Luftetur', '5t'], seven_day: ['Uka', 'uke'] }

export function rows(usage: SessionUsage, now: number): Row[] {
  const { context } = usage
  const out: Row[] = [
    {
      label: 'Luktespor',
      short: 'ctx',
      note: '',
      value:
        context.tokens === undefined
          ? `— / ${tokens(context.window)}`
          : `${tokens(context.tokens)} / ${tokens(context.window)} (${context.percent ?? 0} %)`,
      percent: context.percent ?? 0,
    },
  ]
  for (const limit of usage.rateLimits) {
    const names = LIMITS[limit.kind]
    if (!names) continue
    out.push({ label: names[0], short: names[1], note: resets(limit.resetsAt, now), value: `${Math.round(limit.percentUsed)} %`, percent: limit.percentUsed })
  }
  return out.slice(0, 3)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function usageSvg(list: Row[], height: number): string {
  const rowH = Math.floor(height / 3)
  const top = Math.floor((height - rowH * list.length) / 2)
  const body = list
    .map((r, i) => {
      const y = top + i * rowH
      const fill = Math.max(0, Math.min(100, r.percent))
      const tone = fill >= 90 ? 'hot' : fill >= 75 ? 'warm' : 'ok'
      return (
        `<text class="label" x="0" y="${y + 11}">${esc(r.label)}</text>` +
        `<text class="value" x="${INFO_W}" y="${y + 11}" text-anchor="end">${esc(r.value)}</text>` +
        (r.note ? `<text class="value" x="${INFO_W - 40}" y="${y + 11}" text-anchor="end">${esc(r.note)}</text>` : '') +
        `<rect class="track" x="0" y="${y + 15}" width="${INFO_W}" height="3" rx="1.5"/>` +
        (fill > 0 ? `<rect class="${tone}" x="0" y="${y + 15}" width="${(INFO_W * fill) / 100}" height="3" rx="1.5"/>` : '')
      )
    })
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${INFO_W}" height="${height}" viewBox="0 0 ${INFO_W} ${height}">` +
    '<style>' +
    'text{font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}' +
    '.label{fill:#1f1e1d}.value{fill:#8a8780}.track{fill:#e8e6e1}' +
    '.ok{fill:#8c6b4a}.warm{fill:#d9822b}.hot{fill:#d4483b}' +
    '@media (prefers-color-scheme: dark){.label{fill:#ecebe8}.value{fill:#a19e96}.track{fill:#3a3935}.ok{fill:#b08d63}}' +
    '</style>' +
    body +
    '</svg>'
  )
}

// One line for the terminal, where the band is text: "ctx 21% · 5t 18% · uke 35%".
export function usageLine(list: Row[]): string {
  return list.map(r => `${r.short} ${Math.round(r.percent)}%`).join(' · ')
}
