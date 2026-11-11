import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, AgentStatus, On } from 'claude-code'

const BAND = {
  plugin: 'too-ticki',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const agent = (id: string, status: AgentStatus, description: string): AgentInfo => ({ id, status, description, type: 'Explore' })

// The engine beneath the mod: a clock, the usage figures, and the agents.
function world(on: On, agents: () => AgentInfo[]) {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: 210_000, percent: 21 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: agents() }))
  on('tool.call', () => ({ result: {} }))
  return clock
}

test('every running agent is a puppy, and one that ended is not', async ($, on) => {
  world(on, () => [agent('a1', 'running', 'Finn <filene>'), agent('a2', 'waiting', 'Les dokumentasjon'), agent('a3', 'completed', 'Ferdig')])

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const dog = await ui.find({ type: 'Svg' })

  expect(dog?.props.alt).toMatch(/2 valper/)
  const source = String(dog?.props.source)
  expect(source.match(/<title>Valp: /g)?.length).toBe(2)
  // A description is text, never markup.
  expect(source).toContain('Valp: Finn &lt;filene&gt; (Explore)')
  expect(source.length).toBeLessThan(131_072)
  await ui.unmount()
})

test('with no agent running she walks alone', async ($, on) => {
  world(on, () => [])

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const dog = await ui.find({ type: 'Svg' })

  expect(dog?.props.alt).toBe('Too-ticki går mens Claude jobber')
  expect(String(dog?.props.source)).not.toContain('<title>')
  await ui.unmount()
})

test('a puppy arrives when an agent starts and leaves when it ends', async ($, on) => {
  let agents: AgentInfo[] = []
  const clock = world(on, () => agents)

  on('turn.complete', () => ({ text: '' }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).not.toMatch(/valp/)

  agents = [agent('a1', 'running', 'Søk')]
  await $.turn.complete({ agentId: 'a0', turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toMatch(/1 valp /)

  // Nothing announces the end here: the count on the timer finds it.
  agents = [agent('a1', 'completed', 'Søk')]
  await clock.advance(3_000)
  expect((await ui.find({ type: 'Svg' }))?.props.alt).not.toMatch(/valp/)
  await ui.unmount()
})

test('she digs when Claude searches and barks when a call fails', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', ($, e) => (e.tool === 'Bash' && e.command === 'false' ? { result: {}, text: 'no', isError: true } : { result: {} }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await $.tool.call({ tool: 'Bash', command: 'cd src && rg bein' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Too-ticki graver mens Claude søker')

  // A subagent's search is its puppy's business, not hers.
  await clock.advance(10_000)
  await $.tool.call({ tool: 'Read', file_path: '/a', agentId: 'a1' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Too-ticki graver mens Claude søker')

  await $.tool.call({ tool: 'Bash', command: 'false' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Too-ticki bjeffer: noe feilet')
  await ui.unmount()
})
