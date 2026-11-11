import type { EngineInterface, Register } from 'claude-code'

import { BOB, floatSvg, HOME, homeMs, homeSvg, litter, PX, still, VICTORY_MS, wakeFloatSvg, walkSvg, where } from './scene'
import type { Action, Pick, Pup, Spot, Track } from './scene'
import { floatFrames, sitFrames, sleepFrames, walkFrames, walkLeftFrames } from './sprites'
import { INFO_W, rows, usageLine, usageSvg } from './usage'

// How long she sits and blinks after a turn before lying down to sleep.
const AWAKE_MS = 20_000
// Terminal frame rate (desktop animates inside the SVG itself).
const TICK_MS = 140
// She floats while you type, and settles this long after your last key.
const TYPING_MS = 4_000
// How often the usage panel's "Nullstilles om ..." refreshes while she rests.
const USAGE_REFRESH_MS = 60_000
// How often the litter is counted while any agent runs.
const PUPS_POLL_MS = 3_000
// A reaction to a tool redraws the walk (a flicker), so not more often than
// this; a bark at a failure may cut in sooner.
const REACT_MS = 9_000
const BARK_MS = 3_000
// The most puppies drawn at once (the drawing has a size limit).
const MAX_PUPS = 6
// Terminal cell box for one frame (cells are about twice as tall as wide).
const COLS = 10
const ROWS = 5

type Mode = 'walk' | 'home' | 'float' | 'sit' | 'sleep'

const ALT: Record<Mode, string> = {
  walk: 'Too-ticki går mens Claude jobber',
  home: 'Too-ticki feirer, og rusler tilbake til plassen sin',
  float: 'Too-ticki svever mens du skriver',
  sit: 'Too-ticki sitter',
  sleep: 'Too-ticki sover',
}

const pick = (frames: string[], i: number): string => frames[i % frames.length] ?? ''

// Random actions while Claude works: each walk drawing carries two kinds,
// played at random spots and times as it loops.
const ACTIONS: Action[] = ['dig', 'zoomies', 'sniff']
function randomPicks(): Pick[] {
  const kinds = [...ACTIONS].sort(() => Math.random() - 0.5).slice(0, 2)
  return kinds.map(action => ({ action, dir: Math.random() < 0.5 ? 1 : -1 }))
}

// What she does when Claude uses a tool: digs while it searches, sniffs at
// what it reads. (A failed call of any tool gets a bark.) Some of these names
// are other builds' tools.
const REACTIONS: Record<string, Action> = {
  Grep: 'dig',
  Glob: 'dig',
  ToolSearch: 'dig',
  WebSearch: 'dig',
  LSP: 'dig',
  Read: 'sniff',
  WebFetch: 'sniff',
  NotebookRead: 'sniff',
}
// Most searching and reading goes through the shell: go by the command.
const SEARCHES = /(^|[\s|;&(])(rg|grep|egrep|fgrep|ag|ack|find|fd|locate)\s/
const READS = /(^|[\s|;&(])(cat|head|tail|less|bat|wc)\s/
const shellReaction = (command: string): Action | undefined =>
  SEARCHES.test(command) ? 'dig' : READS.test(command) ? 'sniff' : undefined

const REACT_ALT: Record<Action, string> = {
  dig: 'Too-ticki graver mens Claude søker',
  sniff: 'Too-ticki snuser mens Claude leser',
  bark: 'Too-ticki bjeffer: noe feilet',
  zoomies: ALT.walk,
}

// An agent counts as running (and has a puppy) until its loop has ended.
const ENDED = new Set(['completed', 'failed', 'killed'])

// The litter: one puppy for each running agent, in the order they arrived.
// Each keeps its coat, and its track so a redraw picks it up where it is.
type Litter = {
  pups: { id: string; title: string }[]
  coatOf: Map<string, number>
  coatNext: number
  tracks: Record<string, Track>
  timer?: { cancel(): void }
}

// Count the litter; true when a puppy arrived or left.
async function count($: EngineInterface, den: Litter): Promise<boolean> {
  const live = (await $.agent.list()).filter(a => !ENDED.has(a.status))
  const before = den.pups.map(p => p.id).join(' ')
  den.pups = live.map(a => ({ id: a.id, title: `Valp: ${a.description || a.name || a.type} (${a.type})` }))
  for (const p of den.pups) if (!den.coatOf.has(p.id)) den.coatOf.set(p.id, den.coatNext++)
  return before !== den.pups.map(p => p.id).join(' ')
}

// Keep counting while any agent runs; stop once the litter is empty.
function watch($: EngineInterface, den: Litter): void {
  den.timer ??= $.clock.every(PUPS_POLL_MS, async () => {
    if (await count($, den)) $.ui.invalidate('ui.render')
    if (!den.pups.length) {
      den.timer?.cancel()
      den.timer = undefined
    }
  })
}

export const register: Register = on => {
  const den: Litter = { pups: [], coatOf: new Map(), coatNext: 0, tracks: {} }
  let wasWorking = false
  let idleSince = 0
  let napTimer: { cancel(): void } | undefined
  // Terminal-only animation state.
  let ticker: { cancel(): void } | undefined
  let tick = 0
  let x = 0
  let dir = 1
  // What the walking dog's drawing does, so the next drawing (an action, the
  // walk home) picks up exactly where she is.
  let track: Track | undefined
  // The walk home after a turn: from where, when, how long, with a celebration.
  let homeFrom = 0
  let homeAt = 0
  let homeLen = 0
  let homeTimer: { cancel(): void } | undefined
  let termHoming = false
  // Set when a message wakes the sleeping dog; the next walk starts with a stretch.
  let wakePending = false
  // Asleep: the next thing she does (floating as you type, or walking for a
  // message) starts with a stretch.
  let drowsy = false
  let termWake = 0
  // Typing: whether the prompt box holds text, and when it last changed.
  let hasDraft = false
  let lastEdit = 0
  let typingTimer: { cancel(): void } | undefined
  // What the band shows now. A redraw restarts the SVG's animation, so typing
  // only redraws when it changes the mode, never once per key.
  let shown: Mode | undefined
  const floatChanges = () => shown !== 'walk' && (shown === 'float') !== hasDraft

  // The tool she reacts to at the next drawing, and when she last did.
  let reaction: Action | undefined
  let reactedAt = 0

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (await count($, den)) $.ui.invalidate('ui.render')
    watch($, den)
    return started
  })

  // A subagent's turn ended: its puppy may be leaving.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined && (await count($, den))) $.ui.invalidate('ui.render')
    return done
  })

  // Claude's own tool calls (not a subagent's: those are the puppies' business).
  on('tool.call', async ($, e, next) => {
    const react = async (action: Action, gap: number) => {
      const now = await $.clock.now()
      if (shown !== 'walk' || now - reactedAt < gap) return
      reaction = action
      reactedAt = now
      $.ui.invalidate('ui.render')
    }
    const action = e.agentId !== undefined ? undefined : e.tool === 'Bash' ? shellReaction(e.command) : REACTIONS[e.tool]
    if (action) await react(action, REACT_MS)
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError === true) await react('bark', BARK_MS)
    return ran
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    hasDraft = box.text.length > 0
    lastEdit = await $.clock.now()
    // Settle once typing has paused long enough; redraw now only on a change.
    typingTimer?.cancel()
    typingTimer = $.clock.after(TYPING_MS, () => shown === 'float' && $.ui.invalidate('ui.render'))
    if (floatChanges()) $.ui.invalidate('ui.render')
    return box
  })

  // The hint line says whether the box holds text: a second signal for typing,
  // for a surface whose own prompt box sends no edits.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.props.isDraft !== hasDraft) {
      hasDraft = e.props.isDraft
      lastEdit = await $.clock.now()
      typingTimer?.cancel()
      typingTimer = $.clock.after(TYPING_MS, () => shown === 'float' && $.ui.invalidate('ui.render'))
      if (floatChanges()) $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // Usage moved (after a turn, or a limit moved a point). Redrawing restarts
  // her animation, so only redraw while she rests; a walk or float picks the
  // new figures up at its next redraw anyway.
  const resting = () => shown === 'sit' || shown === 'sleep'
  let usageTimer: { cancel(): void } | undefined

  on('session.measure', ($, e, next) => {
    if (resting() && !den.pups.length) $.ui.invalidate('ui.render')
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (drowsy) wakePending = true
    hasDraft = false
    typingTimer?.cancel()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const working = e.props.isWorking
    const now = await $.clock.now()
    if (wasWorking && !working) {
      idleSince = now
      napTimer?.cancel()
      napTimer = $.clock.after(AWAKE_MS, () => shown === 'sit' && $.ui.invalidate('ui.render'))
      if (shown === 'walk') {
        if (e.surface === 'terminal') {
          termHoming = true
        } else if (track) {
          // Where the walking dog is now, read off her drawing's own clock.
          homeFrom = where(track, now).x
          homeAt = now
          homeLen = homeMs(track.width, homeFrom, true)
          homeTimer?.cancel()
          // Once home, the drawing already shows her sitting: no redraw.
          // A long walk home outlasts the nap timer, so set it again for
          // what is left of her sitting time.
          homeTimer = $.clock.after(homeLen, () => {
            if (shown !== 'home') return
            shown = 'sit'
            napTimer?.cancel()
            napTimer = $.clock.after(Math.max(1_000, AWAKE_MS - homeLen), () => shown === 'sit' && $.ui.invalidate('ui.render'))
          })
        }
      }
    }
    wasWorking = working
    const typing = hasDraft && now - lastEdit < TYPING_MS
    const homing = e.surface === 'terminal' ? termHoming : homeAt > 0 && now - homeAt < homeLen
    const mode: Mode = working
      ? 'walk'
      : typing
        ? 'float'
        : homing
          ? 'home'
          : idleSince && now - idleSince < AWAKE_MS
            ? 'sit'
            : 'sleep'
    const wasShown = shown
    shown = mode
    const wakeToFloat = mode === 'float' && drowsy
    drowsy = mode === 'sleep'
    if (mode === 'walk' || mode === 'float') {
      homeAt = 0
      termHoming = false
    }
    const usage = rows(await $.session.usage(), now)
    usageTimer ??= $.clock.every(USAGE_REFRESH_MS, () => resting() && !den.pups.length && $.ui.invalidate('ui.render'))
    // A session that already has agents running (resumed, or the mod reloaded).
    await count($, den)
    if (den.pups.length) watch($, den)
    const pups = den.pups
    const litterAlt = pups.length ? `, med ${pups.length} ${pups.length === 1 ? 'valp' : 'valper'} (én for hver agent som kjører)` : ''

    if (e.surface === 'desktop') {
      ticker?.cancel()
      ticker = undefined
      const { Box, Svg } = $.ui.resolve(e)
      const width = Math.max(PX * 2, e.props.bodyColumns * 8 - INFO_W - 24)
      // Where she is now, for a puppy that has only just arrived.
      const mum: Spot = mode === 'walk' && wasShown === 'walk' && track ? where(track, now) : { x: HOME + 24, dir: 1 }
      const drawn: Pup[] = pups.slice(0, MAX_PUPS).map(p => ({
        id: p.id,
        title: p.title,
        coat: den.coatOf.get(p.id) ?? 0,
        from: den.tracks[p.id] ? where(den.tracks[p.id], now) : mum,
      }))
      const pack = litter(width, drawn)
      den.tracks = Object.fromEntries(Object.entries(pack.tracks).map(([id, t]) => [id, { at: now, ...t }]))
      const extra = pack.source
      let source: string
      let alt = ALT[mode]
      if (mode === 'walk') {
        // Pick up where she is if she was already walking; else from her spot.
        // The whole walk, actions included, is this one drawing: no redraws
        // (a redraw flickers) until Claude stops, a tool sets her off, or a
        // puppy comes or goes.
        const from: Spot = wasShown === 'walk' && track ? where(track, now) : { x: HOME, dir: 1 }
        const react = wakePending ? undefined : reaction
        const walked = walkSvg(width, from, randomPicks(), { wake: wakePending, react, extra })
        if (wakePending) alt = 'Too-ticki strekker seg våken, og går'
        else if (react) alt = REACT_ALT[react]
        wakePending = false
        track = { at: now, ...walked.track }
        source = walked.source
      } else if (wakeToFloat) {
        source = wakeFloatSvg(width, extra)
        alt = 'Too-ticki strekker seg våken mens du skriver'
      } else if (mode === 'home') {
        // Redrawn partway home: carry on from where she has got to.
        const t = now - homeAt
        const walkLen = homeLen - VICTORY_MS
        source =
          t < VICTORY_MS
            ? homeSvg(width, homeFrom, true, extra)
            : homeSvg(width, homeFrom - ((homeFrom - HOME) * (t - VICTORY_MS)) / Math.max(1, walkLen), false, extra)
      } else if (mode === 'float') {
        source = floatSvg(width, extra)
      } else {
        source = still(mode, width, extra)
      }
      reaction = undefined
      return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexShrink={1} overflow="hidden">
            <Svg source={source} alt={alt + litterAlt} width={width} height={PX + BOB} isInteractive />
          </Box>
          <Box flexShrink={0} paddingRight={1}>
            <Svg source={usageSvg(usage, PX + BOB)} alt={usage.map(r => [r.label, r.note, r.value].filter(Boolean).join(' ')).join(', ')} width={INFO_W} height={PX + BOB} />
          </Box>
        </Box>
      )
    }

    if (e.surface === 'terminal') {
      const { Box, Image } = $.ui.resolve(e)
      reaction = undefined
      // Keep a ticker running while drawn on the terminal; each tick redraws.
      ticker ??= $.clock.every(TICK_MS, () => {
        tick += 1
        $.ui.invalidate('ui.render')
      })
      const line = (pups.length ? `${pups.length} ${pups.length === 1 ? 'valp' : 'valper'} · ` : '') + usageLine(usage)
      const span = Math.max(0, e.props.bodyColumns - COLS - line.length - 2)
      let png: string
      if (mode === 'home') {
        // Walk left back to the start, then sit.
        x = Math.max(0, x - 1)
        if (x === 0) termHoming = false
        png = pick(walkLeftFrames, tick)
      } else if ((mode === 'walk' || mode === 'float') && (wakePending || wakeToFloat || termWake > 0)) {
        // Lying for a few ticks, then stretched long (a wider box), then off.
        if (wakePending || wakeToFloat) {
          wakePending = false
          termWake = 1
          x = 0
          dir = 1
        }
        termWake += 1
        if (termWake > 11) termWake = 0
        png = pick(termWake <= 4 ? sleepFrames : walkFrames, 0)
      } else if (mode === 'walk') {
        x += dir
        if (x >= span) dir = -1
        if (x <= 0) dir = 1
        x = Math.min(Math.max(0, x), span)
        png = pick(dir > 0 ? walkFrames : walkLeftFrames, tick)
      } else if (mode === 'float') {
        png = pick(floatFrames, Math.floor(tick / 3))
      } else if (mode === 'sit') {
        png = pick(sitFrames, tick % 24 < 21 ? 0 : 1 + (tick % 24) - 21)
      } else {
        png = pick(sleepFrames, Math.floor(tick / 5))
      }
      const { Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box paddingLeft={mode === 'walk' || mode === 'home' ? x : 1}>
            <Image source={{ png }} columns={termWake > 4 ? COLS + 3 : COLS} rows={ROWS} alt={mode === 'sleep' ? 'U´ᴥ`U zZ' : 'U・ᴥ・U'} />
          </Box>
          <Text dimColor>{line}</Text>
        </Box>
      )
    }

    return next(e)
  })
}
