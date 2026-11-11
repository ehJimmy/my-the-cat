import * as acts from './actions'
import type { Strip } from './actions'
import { coats, PUP_H, PUP_W } from './pups'
import { float, GRID, sit, sleep, walk } from './vectors'
import type { Frame } from './vectors'

// Desktop drawings: each one self-animating SVG made of plain paths (no
// embedded image, no <use>), so it draws wherever SVG does. SMIL shows one
// frame at a time and moves the dog.
//
// A redraw reloads the drawing, which shows as a flicker, so the hooks module
// only redraws when something changes: Claude starts or stops working, you
// start or stop typing, she falls asleep, she reacts to a tool, or a puppy
// arrives or leaves. Everything else is one looping drawing.

// Drawn size of one main frame, in CSS pixels, and headroom for the float's bob.
export const PX = 60
export const BOB = 6
// Where the dog rests (her centre).
export const HOME = 8 + PX / 2
// One sprite pixel, in CSS pixels: the same for her, her strips and the puppies.
const ACT = PX / GRID
// The most the Svg element takes, with a little room to spare.
const LIMIT = 128_000

export type Dir = 1 | -1
export type Action = 'dig' | 'sniff' | 'bark' | 'zoomies'
// One action strip a walk drawing carries: which action, and which way it faces.
export type Pick = { action: Action; dir: Dir }

// The band's walkable span for a width, and walking speed in px per second.
export const pace = (width: number) => {
  const end = Math.max(0, width - PX - 8)
  return { lo: HOME, hi: HOME + end, end, speed: 40 }
}

// --- Where a dog is -------------------------------------------------------------

// A drawing's path for a dog: keyframes over one cycle (ms), moving in a
// straight line between them, facing `dir` from each one; looping from
// `begin` ms after the drawing was drawn at `at`.
export type Key = { t: number; x: number; dir: Dir }
export type Track = { at: number; width: number; begin: number; cycle: number; keys: Key[] }
export type Spot = { x: number; dir: Dir }

export function where(track: Track | undefined, now: number): Spot {
  const first = track?.keys[0]
  if (!track || !first) return { x: HOME, dir: 1 }
  const t = now - track.at - track.begin
  if (t < 0 || track.cycle <= 0) return { x: first.x, dir: first.dir }
  const tt = t % track.cycle
  for (let i = 1; i < track.keys.length; i++) {
    const a = track.keys[i - 1]!
    const b = track.keys[i]!
    if (tt <= b.t) return { x: b.t > a.t ? a.x + ((b.x - a.x) * (tt - a.t)) / (b.t - a.t) : b.x, dir: a.dir }
  }
  return { x: first.x, dir: first.dir }
}

// --- Drawing pieces -------------------------------------------------------------

const open = (width: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${PX + BOB}" viewBox="0 0 ${width} ${PX + BOB}" shape-rendering="crispEdges">`

const paths = (frame: Frame) => frame.map(([c, d]) => `<path stroke="${c}" d="${d}"/>`).join('')
const f2 = (n: number) => +n.toFixed(2)
const k4 = (n: number) => +n.toFixed(4)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Steps of a discrete animation as [time, value]: where two share a time, the
// later one wins.
function steps<T>(list: [number, T][]): [number, T][] {
  return list.filter((s, i) => i === list.length - 1 || list[i + 1]![0] > s[0])
}

// Frames shown one at a time in the order `seq`, `step` seconds each, from
// `begin`; `times` loops (default forever), holding the last frame after.
function flip(frames: Frame[], step: number, opts: { seq?: number[]; begin?: number; times?: number; keyTimes?: string } = {}): string {
  const seq = opts.seq ?? frames.map((_, i) => i)
  if (frames.length === 1) return `<g fill="none">${paths(frames[0]!)}</g>`
  const at =
    `dur="${f2(seq.length * step)}s" begin="${opts.begin ?? 0}s" ` +
    (opts.times ? `repeatCount="${opts.times}" fill="freeze"` : 'repeatCount="indefinite"') +
    (opts.keyTimes ? ` keyTimes="${opts.keyTimes}"` : '')
  return (
    '<g fill="none">' +
    frames
      .map((frame, i) => {
        if (!seq.includes(i)) return ''
        const values = seq.map(j => (j === i ? 'visible' : 'hidden')).join(';')
        return (
          `<g visibility="${seq[0] === i ? 'visible' : 'hidden'}">` +
          `<animate attributeName="visibility" values="${values}" calcMode="discrete" ${at}/>${paths(frame)}</g>`
        )
      })
      .join('') +
    '</g>'
  )
}

// A main-sheet sprite, centred on x = 0, top at y = 0.
const main = (inner: string) => `<g transform="translate(${-PX / 2} 0) scale(${ACT})">${inner}</g>`

const walker = () => main(flip(walk, 0.15))
// Sit: eyes open most of the time, a quick blink, a wag of the tail.
const sitter = (still = false) =>
  main(still ? flip(sit.slice(0, 1), 1) : flip(sit, 0.8, { keyTimes: '0;0.85;0.9;0.95' }))

// Shown from `from` to `to` seconds (opacity: frames set their own visibility,
// which would override a parent's).
const during = (from: number, to: number | undefined, body: string) =>
  `<g opacity="${from <= 0 ? 1 : 0}">` +
  (from > 0 ? `<set attributeName="opacity" to="1" begin="${f2(from)}s" fill="freeze"/>` : '') +
  (to !== undefined ? `<set attributeName="opacity" to="0" begin="${f2(to)}s" fill="freeze"/>` : '') +
  `${body}</g>`

const left = (strip: Strip, cx: number) => f2(cx - strip.ax * ACT)
// Where a strip's dog can stand with the whole strip (prop included) in the band.
const room = (strip: Strip, width: number) => {
  const { lo, hi } = pace(width)
  return { lo: Math.max(lo, strip.ax * ACT + 2), hi: Math.min(hi, width - (strip.w - strip.ax) * ACT - 2) }
}
const top = (strip: Strip) => f2(BOB + PX - strip.h * ACT)

// --- The wander ------------------------------------------------------------------

type Occ = { pick: Pick; t0: number; t1: number; x0: number; x1: number }

// How each action plays: its strip, frame order, seconds per frame, and how
// many times through.
function plan(p: Pick): { strip: Strip; seq: number[]; step: number; times: number } {
  const way = p.dir > 0 ? 'right' : 'left'
  if (p.action === 'dig') return { strip: acts.dig[way]!, seq: [0, 1, 2, 3], step: 0.13, times: 5 }
  if (p.action === 'sniff') return { strip: acts.sniff[way]!, seq: [0, 1, 2, 3], step: 0.24, times: 3 }
  // Two barks, a breath, one more.
  if (p.action === 'bark') return { strip: acts.bark[way]!, seq: [0, 1, 0, 1, 0, 2, 3, 2], step: 0.17, times: 1 }
  return { strip: acts.zoomies[way]!, seq: [0, 1, 2, 3], step: 0.09, times: 0 }
}

// A dog's program for one loop: wander, then an action at a random spot, a few
// times over, then back to where it started so the loop is seamless. `react`
// plays first, on the spot. With no picks it only wanders (a puppy).
function program(
  span: { lo: number; hi: number; speed: number },
  width: number,
  from: Spot,
  picks: Pick[],
  rand: () => number,
  react?: Pick,
) {
  const { lo, hi, speed } = span
  const between = (a: number, b: number) => a + rand() * Math.max(0, b - a)
  const keys: Key[] = [{ t: 0, x: from.x, dir: from.dir }]
  const occs: Occ[] = []
  let t = 0
  let x = from.x
  let dir = from.dir
  const moveTo = (p: number, v = speed) => {
    p = Math.min(hi, Math.max(lo, p))
    if (Math.abs(p - x) < 1) return
    dir = p > x ? 1 : -1
    keys[keys.length - 1]!.dir = dir
    t += (Math.abs(p - x) / v) * 1000
    x = p
    keys.push({ t, x, dir })
  }
  const hold = (ms: number) => {
    t += ms
    keys.push({ t, x, dir })
  }
  const wander = (ms: number) => {
    let left = ms
    while (left > 50 && hi - lo > 2) {
      // Turn around somewhere random up ahead (or at the edge).
      const ahead = dir > 0 ? hi - x : x - lo
      if (ahead < 30) {
        dir = dir > 0 ? -1 : 1
        continue
      }
      const go = Math.min(ahead, between(40, ahead), (left / 1000) * speed)
      moveTo(x + dir * go)
      left -= (go / speed) * 1000
      if (rand() < 0.6) dir = dir > 0 ? -1 : 1
    }
  }
  if (react) {
    const { seq, step, times } = plan(react)
    hold(seq.length * step * Math.max(1, times) * 1000)
    occs.push({ pick: react, t0: 0, t1: t, x0: x, x1: x })
  }
  if (hi - lo <= 80) {
    hold(10_000)
  } else if (!picks.length) {
    // A puppy: scamper about, a breather now and then.
    for (let i = 0; i < 4; i++) {
      wander(between(5_000, 12_000))
      hold(between(600, 2_500))
    }
    moveTo(from.x)
    keys[keys.length - 1]!.dir = from.dir
  } else {
    for (let i = 0; i < 3; i++) {
      const pick = picks[i % picks.length]!
      const { strip, seq, step, times } = plan(pick)
      // Spots where the whole strip (hole, ball) fits in the band.
      const fit = room(strip, width)
      wander(between(12_000, 35_000))
      if (pick.action === 'zoomies') {
        // Sprint after the ball, three and a half times walking speed.
        const z = pick.dir
        const w = fit.hi - fit.lo
        const start = z > 0 ? between(fit.lo, fit.lo + w * 0.4) : between(fit.lo + w * 0.6, fit.hi)
        moveTo(start)
        const t0 = t
        const end = z > 0 ? between(Math.max(start + 80, fit.lo + w * 0.6), fit.hi) : between(fit.lo, Math.min(start - 80, fit.lo + w * 0.4))
        moveTo(Math.min(fit.hi, Math.max(fit.lo, end)), speed * 3.5)
        occs.push({ pick, t0, t1: t, x0: start, x1: x })
      } else {
        moveTo(between(fit.lo, fit.hi))
        const t0 = t
        hold(seq.length * step * times * 1000)
        occs.push({ pick, t0, t1: t, x0: x, x1: x })
      }
    }
    // Back to where she started, so the loop picks up seamlessly.
    wander(between(4_000, 10_000))
    moveTo(from.x)
    keys[keys.length - 1]!.dir = from.dir
  }
  return { keys, occs, cycle: t }
}

// A sprite that follows `keys` over one looping cycle, facing each leg's way,
// hidden while any of `occs` plays. `sprite` is centred on x = 0.
function mover(keys: Key[], occs: Occ[], cycle: number, begin: number, y: number, sprite: string, hidden = false): string {
  const at = `begin="${f2(begin)}s" dur="${f2(cycle / 1000)}s" repeatCount="indefinite"`
  const kt = (ms: number) => k4(Math.min(1, Math.max(0, ms / cycle)))
  const first = keys[0]!
  if (keys.length < 2 || cycle <= 0) return `<g transform="translate(${f2(first.x)} ${y})"><g transform="scale(${first.dir} 1)">${sprite}</g></g>`
  const moves =
    `<animateTransform attributeName="transform" type="translate" values="${keys.map(k => `${f2(k.x)} ${y}`).join(';')}" ` +
    `keyTimes="${keys.map(k => kt(k.t)).join(';')}" ${at}/>`
  const faceKeys = steps(keys.slice(0, -1).map(k => [k.t, k.dir] as [number, Dir]))
  const faces =
    `<animateTransform attributeName="transform" type="scale" values="${faceKeys.map(k => `${k[1]} 1`).join(';')}" ` +
    `keyTimes="${faceKeys.map(k => kt(k[0])).join(';')}" calcMode="discrete" ${at}/>`
  let shown = ''
  if (occs.length || hidden) {
    const show = steps([[0, 1], ...occs.flatMap(o => [[o.t0, 0], [o.t1, 1]] as [number, number][])])
    shown = `<animate attributeName="opacity" values="${show.map(s => s[1]).join(';')}" keyTimes="${show.map(s => kt(s[0])).join(';')}" calcMode="discrete" ${at}/>`
  }
  return (
    `<g opacity="${hidden || occs[0]?.t0 === 0 ? 0 : 1}">${shown}<g transform="translate(${f2(first.x)} ${y})">${moves}` +
    `<g transform="scale(${first.dir} 1)">${faces}${sprite}</g></g></g>`
  )
}

// --- Puppies: one for each agent that is running -----------------------------------

export type Pup = { id: string; coat: number; title: string; from?: Spot }

const PUP_PX = PUP_W * ACT
const pupSpan = (width: number, rand: () => number) => ({
  lo: 6 + PUP_PX / 2,
  hi: Math.max(6 + PUP_PX / 2, width - PUP_PX / 2 - 6),
  speed: 48 + rand() * 26,
})

// The puppies' layer for any drawing, and each one's track, so the next
// drawing picks every puppy up where it is.
export function litter(width: number, pups: Pup[], rand: () => number = Math.random): { source: string; tracks: Record<string, Omit<Track, 'at'>> } {
  const tracks: Record<string, Omit<Track, 'at'>> = {}
  let source = ''
  const y = f2(BOB + PX - PUP_H * ACT)
  for (const pup of pups) {
    const span = pupSpan(width, rand)
    const from: Spot = { x: Math.min(span.hi, Math.max(span.lo, pup.from?.x ?? HOME + 20)), dir: pup.from?.dir ?? 1 }
    const { keys, cycle } = program(span, width, from, [], rand)
    const frames = coats[pup.coat % coats.length]!
    const sprite = `<g transform="translate(${f2(-PUP_PX / 2)} 0) scale(${f2(ACT)})">${flip(frames, 0.11, { seq: [0, 1, 2, 1] })}</g>`
    source += `<g><title>${esc(pup.title)}</title>${mover(keys, [], cycle, 0, y, sprite)}</g>`
    tracks[pup.id] = { width, begin: 0, cycle, keys }
  }
  return { source, tracks }
}

// --- Simple drawings ------------------------------------------------------------

export function still(mode: 'sit' | 'sleep', width: number, extra = ''): string {
  const body = mode === 'sit' ? sitter() : main(flip(sleep, 0.7))
  return `${open(width)}<g transform="translate(${HOME} ${BOB})">${body}</g>${extra}</svg>`
}

// Gently bob: middle, up, middle, down, from `begin` seconds.
function bobbing(begin = 0): string {
  const bob = [BOB / 2, 0, BOB / 2, BOB, BOB / 2].map(y => `${HOME} ${y}`).join(';')
  return (
    `<g transform="translate(${HOME} ${BOB / 2})"><animateTransform attributeName="transform" type="translate" values="${bob}" dur="1.6s" begin="${begin}s" repeatCount="indefinite"/>` +
    `${main(flip(float, 0.2, { begin }))}</g>`
  )
}

export const floatSvg = (width: number, extra = '') => `${open(width)}${bobbing()}${extra}</svg>`

// Woken up (you start typing, or a message arrives): lying down, then a long
// low stretch (the side-on dog drawn longer and lower, eased in and out).
export const WAKE = { curl: 0.4, stretch: 1.1 }
export const WAKE_MS = (WAKE.curl + WAKE.stretch) * 1000

function waking(): string {
  const { curl, stretch } = WAKE
  const stretchy =
    `<g transform="translate(${HOME} ${BOB + PX})"><g>` +
    `<animateTransform attributeName="transform" type="scale" values="1 1;1.24 0.78;1.24 0.78;1 1" keyTimes="0;0.35;0.7;1" ` +
    `calcMode="spline" keySplines="0.4 0 0.2 1;0 0 1 1;0.4 0 0.2 1" dur="${stretch}s" begin="${curl}s" fill="freeze"/>` +
    `<g transform="translate(0 ${-PX})">${main(flip(walk.slice(0, 1), 1))}</g></g></g>`
  return (
    during(0, curl, `<g transform="translate(${HOME} ${BOB})">${main(flip(sleep.slice(0, 1), 1))}</g>`) +
    during(curl, curl + stretch, stretchy)
  )
}

export const wakeFloatSvg = (width: number, extra = '') =>
  `${open(width)}${waking()}${during(WAKE_MS / 1000, undefined, bobbing(WAKE_MS / 1000))}${extra}</svg>`

// --- The walk, with actions ----------------------------------------------------------

// The walk drawing, after an optional wake-up. `react` plays first, where she
// stands (a tool Claude just used); `picks` play at random spots as it loops.
export function walkSvg(
  width: number,
  at: Spot,
  picks: Pick[],
  opts: { wake?: boolean; react?: Action; rand?: () => number; extra?: string } = {},
): { source: string; track: Omit<Track, 'at'> } {
  // Where she was may be off a band that has since narrowed.
  const from: Spot = { x: Math.min(pace(width).hi, Math.max(pace(width).lo, at.x)), dir: at.dir }
  const begin = opts.wake ? WAKE_MS : 0
  const rand = opts.rand ?? Math.random
  const extra = opts.extra ?? ''
  const react: Pick | undefined = opts.react && { action: opts.react, dir: from.dir }
  // Too big for one Svg: carry fewer kinds of action.
  for (let n = picks.length; ; n--) {
    const { keys, occs, cycle } = program(pace(width), width, from, picks.slice(0, Math.max(1, n)), rand, react)
    const source = draw(width, keys, occs, cycle, begin, opts.wake, extra)
    if (source.length <= LIMIT || n <= 1) return { source, track: { width, begin, cycle, keys } }
  }
}

function draw(width: number, keys: Key[], occs: Occ[], cycle: number, beginMs: number, wake: boolean | undefined, extra: string): string {
  const begin = beginMs / 1000
  const at = `begin="${f2(begin)}s" dur="${f2(cycle / 1000)}s" repeatCount="indefinite"`
  const kt = (ms: number) => k4(Math.min(1, Math.max(0, ms / cycle)))
  const walkerG = mover(keys, occs, cycle, begin, BOB, walker(), wake)

  // Each action strip: hidden except while it plays; frames stepped through on
  // the same loop clock, placed where she stands (zoomies sprinting along).
  const byStrip = new Map<Strip, Occ[]>()
  for (const o of occs) {
    const s = plan(o.pick).strip
    byStrip.set(s, [...(byStrip.get(s) ?? []), o])
  }
  let strips = ''
  for (const [strip, list] of byStrip) {
    // Which frame is showing at each change, over the loop (-1: none).
    const raw: [number, number][] = [[0, -1]]
    for (const o of list) {
      const { seq, step } = plan(o.pick)
      for (let s = o.t0, n = 0; s < o.t1 - 1; s += step * 1000, n++) raw.push([s, seq[n % seq.length]!])
      raw.push([o.t1, -1])
    }
    const marks = steps(raw)
    const frames = strip.frames
      .map((frame, i) => {
        if (!marks.some(m => m[1] === i)) return ''
        // Before the loop starts (a wake-up), nothing shows.
        const first = !wake && marks[0]![1] === i ? 'visible' : 'hidden'
        return (
          `<g visibility="${first}"><animate attributeName="visibility" values="${marks.map(m => (m[1] === i ? 'visible' : 'hidden')).join(';')}" ` +
          `keyTimes="${marks.map(m => kt(m[0])).join(';')}" calcMode="discrete" ${at}/>${paths(frame)}</g>`
        )
      })
      .join('')
    // Position: each play's start and end spot (in between, it's hidden).
    const pos: [number, number][] = [[0, list[0]!.x0]]
    for (const o of list) pos.push([o.t0, o.x0], [o.t1, o.x1])
    pos.push([cycle, list[list.length - 1]!.x1])
    const place =
      `<animateTransform attributeName="transform" type="translate" values="${pos.map(p => `${left(strip, p[1])} ${top(strip)}`).join(';')}" ` +
      `keyTimes="${pos.map(p => kt(p[0])).join(';')}" ${at}/>`
    strips += `<g transform="translate(${left(strip, list[0]!.x0)} ${top(strip)})">${place}<g transform="scale(${f2(ACT)})" fill="none">${frames}</g></g>`
  }
  // While waking, the walker and strips are hidden: their loop animations
  // only start once the wake-up is done.
  return `${open(width)}${wake ? waking() : ''}${walkerG}${strips}${extra}</svg>`
}

// --- The task is done -----------------------------------------------------------

// She sits up and begs beside her golden bone where she stands, then faces
// home, walks back and sits.
export const VICTORY = { step: 0.22, seq: [0, 1, 2, 3, 2, 3, 1, 0] }
export const VICTORY_MS = VICTORY.seq.length * VICTORY.step * 1000
export const homeMs = (width: number, x: number, victory: boolean) =>
  (victory ? VICTORY_MS : 0) + (Math.max(0, x - HOME) / pace(width).speed) * 1000

// Confetti for the celebration: little pixel squares in her colours (collar
// red, tag gold, plus a few cheerful extras) drifting down from the top of the
// band, tumbling as they go, fading out at the bottom. Seeded by where she
// stands, so a redraw of the same moment draws the same confetti.
const CONFETTI = ['#d23c3c', '#f2c14e', '#3b6fd4', '#5bb974', '#f08ca0', '#e8892b']

function confetti(width: number, dogX: number, seed: number, pieces = 56): string {
  let n = seed >>> 0 || 1
  const rand = () => {
    n = (n * 1664525 + 1013904223) >>> 0
    return n / 2 ** 32
  }
  const H = PX + BOB
  let out = ''
  for (let i = 0; i < pieces; i++) {
    // Half the burst around the dog, the rest anywhere in the band.
    const x0 = i % 2 ? rand() * width : Math.min(width - 4, Math.max(0, dogX + (rand() - 0.5) * 240))
    const drift = (rand() - 0.5) * 40
    const size = rand() < 0.3 ? 5 : rand() < 0.5 ? 4 : 3
    const begin = f2(rand() * 0.9)
    const dur = f2(1.3 + rand() * 0.9)
    const color = CONFETTI[Math.floor(rand() * CONFETTI.length)]!
    const at = `begin="${begin}s" dur="${dur}s" fill="freeze"`
    out +=
      `<g opacity="0" transform="translate(${f2(x0)} -4)">` +
      `<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.75;1" ${at}/>` +
      `<animateTransform attributeName="transform" type="translate" values="${f2(x0)} -4;${f2(x0 + drift)} ${H}" ${at}/>` +
      // Tumbling: the piece flips edge-on and back as it falls.
      `<rect width="${size}" height="${size}" fill="${color}">` +
      `<animateTransform attributeName="transform" type="scale" values="1 1;0.2 1;1 1" dur="${f2(0.4 + rand() * 0.4)}s" begin="${begin}s" repeatCount="indefinite"/></rect></g>`
  }
  return `<g>${out}</g>`
}

export function homeSvg(width: number, from: number, victory: boolean, extra = ''): string {
  const x = Math.min(pace(width).hi, Math.max(pace(width).lo, from))
  const v = victory ? VICTORY_MS / 1000 : 0
  const arrive = v + Math.max(0, x - HOME) / pace(width).speed
  const strip = acts.victory.toward!
  const cheer = victory
    ? during(0, v, `<g transform="translate(${left(strip, Math.min(room(strip, width).hi, Math.max(room(strip, width).lo, x)))} ${top(strip)})"><g transform="scale(${f2(ACT)})">${flip(strip.frames, VICTORY.step, { seq: VICTORY.seq, times: 1 })}</g></g>`)
    : ''
  const walkHome = during(
    v,
    arrive,
    `<g transform="translate(${f2(x)} ${BOB})"><animateTransform attributeName="transform" type="translate" values="${f2(x)} ${BOB};${HOME} ${BOB}" ` +
      `begin="${f2(v)}s" dur="${f2(Math.max(0.01, arrive - v))}s" fill="freeze"/><g transform="scale(-1 1)">${walker()}</g></g>`,
  )
  // Keep under the Svg size limit: the blinking sit if it fits, else a still one.
  const sat = (stillSit: boolean) => during(arrive, undefined, `<g transform="translate(${HOME} ${BOB})">${sitter(stillSit)}</g>`)
  // Confetti falls over the celebration, on top of everything else.
  const party = victory ? confetti(width, x, Math.round(x * 97)) : ''
  const body = cheer.length + walkHome.length + party.length + extra.length + sat(false).length < LIMIT - 500 ? sat(false) : sat(true)
  return `${open(width)}${cheer}${walkHome}${body}${extra}${party}</svg>`
}
