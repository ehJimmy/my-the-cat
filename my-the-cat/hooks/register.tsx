import type { Register } from 'claude-code'

import { BOB, floatSvg, HOME, homeMs, homeSvg, PX, still, VICTORY_MS, wakeFloatSvg, walkSvg, where } from './scene'
import type { Action, Dir, Pick, Track } from './scene'
import { floatFrames, sitFrames, sleepFrames, walkFrames, walkLeftFrames } from './sprites'
import { INFO_W, rows, usageLine, usageSvg } from './usage'

// How long the cat sits and blinks after a turn before curling up to sleep.
const AWAKE_MS = 20_000
// Terminal frame rate (desktop animates inside the SVG itself).
const TICK_MS = 140
// The cat floats while you type, and settles this long after your last key.
const TYPING_MS = 4_000
// How often the usage panel's "Resets in ..." refreshes while the cat rests.
const USAGE_REFRESH_MS = 60_000
// Terminal cell box for one frame (cells are about twice as tall as wide).
const COLS = 10
const ROWS = 5

type Mode = 'walk' | 'home' | 'float' | 'sit' | 'sleep'

const ALT: Record<Mode, string> = {
  walk: 'My-the-cat walking while Claude works',
  home: 'My-the-cat celebrating, then walking back to its spot',
  float: 'My-the-cat floating while you type',
  sit: 'My-the-cat sitting',
  sleep: 'My-the-cat sleeping',
}

const pick = (frames: string[], i: number): string => frames[i % frames.length] ?? ''

// Random actions while Claude works: each walk drawing carries two kinds
// (the size limit allows two), played at random spots and times as it loops.
const ACTIONS: Action[] = ['scratch', 'zoomies', 'meow']
function randomPicks(): Pick[] {
  const kinds = [...ACTIONS].sort(() => Math.random() - 0.5).slice(0, 2)
  return kinds.map(action => ({ action, dir: Math.random() < 0.5 ? 1 : -1 }))
}

export const register: Register = on => {
  let wasWorking = false
  let idleSince = 0
  let napTimer: { cancel(): void } | undefined
  // Terminal-only animation state.
  let ticker: { cancel(): void } | undefined
  let tick = 0
  let x = 0
  let dir = 1
  // What the walking cat's drawing does, so the next drawing (an action, the
  // walk home) picks up exactly where the cat is.
  let track: Track | undefined
  // The walk home after a turn: from where, when, how long, with a victory stretch.
  let homeFrom = 0
  let homeAt = 0
  let homeLen = 0
  let homeTimer: { cancel(): void } | undefined
  let termHoming = false
  // Set when a message wakes the sleeping cat; the next walk starts with a stretch.
  let wakePending = false
  // Asleep: the next thing it does (floating as you type, or walking for a
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

  // Usage moved (after a turn, or a limit moved a point). Redrawing restarts the
  // cat's animation, so only redraw while it rests; a walk or float picks the
  // new figures up at its next redraw anyway.
  const resting = () => shown === 'sit' || shown === 'sleep'
  let usageTimer: { cancel(): void } | undefined

  on('session.measure', ($, e, next) => {
    if (resting()) $.ui.invalidate('ui.render')
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
          // Where the walking cat is now, read off its drawing's own clock.
          homeFrom = where(track, now).x
          homeAt = now
          homeLen = homeMs(track.width, homeFrom, true)
          homeTimer?.cancel()
          // Once home, the drawing already shows the cat sitting: no redraw.
          homeTimer = $.clock.after(homeLen, () => {
            if (shown === 'home') shown = 'sit'
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
    usageTimer ??= $.clock.every(USAGE_REFRESH_MS, () => resting() && $.ui.invalidate('ui.render'))

    if (e.surface === 'desktop') {
      ticker?.cancel()
      ticker = undefined
      const { Box, Svg } = $.ui.resolve(e)
      const width = Math.max(PX * 2, e.props.bodyColumns * 8 - INFO_W - 24)
      let source: string
      let alt = ALT[mode]
      if (mode === 'walk') {
        // Pick up where the cat is if it was already walking; else from its spot.
        // The whole walk, random actions included, is this one drawing: no
        // redraws (a redraw flickers) until Claude stops.
        const from: { x: number; dir: Dir } = wasShown === 'walk' && track ? where(track, now) : { x: HOME, dir: 1 }
        const drawn = walkSvg(width, from, randomPicks(), { wake: wakePending })
        if (wakePending) alt = 'My-the-cat stretching awake, then walking'
        wakePending = false
        track = { at: now, ...drawn.track }
        source = drawn.source
      } else if (wakeToFloat) {
        source = wakeFloatSvg(width)
        alt = 'My-the-cat stretching awake as you type'
      } else if (mode === 'home') {
        // Redrawn partway home: carry on from where the cat has got to.
        const t = now - homeAt
        const walkLen = homeLen - VICTORY_MS
        source =
          t < VICTORY_MS
            ? homeSvg(width, homeFrom, true)
            : homeSvg(width, homeFrom - ((homeFrom - HOME) * (t - VICTORY_MS)) / Math.max(1, walkLen), false)
      } else if (mode === 'float') {
        source = floatSvg(width)
      } else {
        source = still(mode, width)
      }
      return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexShrink={1} overflow="hidden">
            <Svg source={source} alt={alt} width={width} height={PX + BOB} isInteractive />
          </Box>
          <Box flexShrink={0} paddingRight={1}>
            <Svg source={usageSvg(usage, PX + BOB)} alt={usage.map(r => [r.label, r.note, r.value].filter(Boolean).join(' ')).join(', ')} width={INFO_W} height={PX + BOB} />
          </Box>
        </Box>
      )
    }

    if (e.surface === 'terminal') {
      const { Box, Image } = $.ui.resolve(e)
      // Keep a ticker running while drawn on the terminal; each tick redraws.
      ticker ??= $.clock.every(TICK_MS, () => {
        tick += 1
        $.ui.invalidate('ui.render')
      })
      const line = usageLine(usage)
      const span = Math.max(0, e.props.bodyColumns - COLS - line.length - 2)
      let png: string
      if (mode === 'home') {
        // Walk left back to the start, then sit.
        x = Math.max(0, x - 1)
        if (x === 0) termHoming = false
        png = pick(walkLeftFrames, tick)
      } else if ((mode === 'walk' || mode === 'float') && (wakePending || wakeToFloat || termWake > 0)) {
        // Curled for a few ticks, then stretched long (a wider box), then off.
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
            <Image source={{ png }} columns={termWake > 4 ? COLS + 3 : COLS} rows={ROWS} alt={mode === 'sleep' ? '(=^-^=) zZ' : '(=^o^=)'} />
          </Box>
          <Text dimColor>{line}</Text>
        </Box>
      )
    }

    return next(e)
  })
}
