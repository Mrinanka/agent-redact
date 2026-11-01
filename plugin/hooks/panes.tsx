// The panes behind `/redact add` and `/redact learn` (spec §8). A value goes from the field to the OS
// store and nowhere else: it is never drawn back, never put in $.state and makes no row. What $.state
// holds for these panes is names, lengths and ticks. The field has no masking, so a value shows while
// it is typed (plan step 4, section 6).

import type { EngineInterface, UiRenderInput } from 'claude-code'
import { addToList } from './backends.ts'
import { now } from './lib/core/decoder.ts'
import { validRegistered } from './lib/core/envfile.ts'
import { outboundText } from './lib/core/outbound.ts'
import { StoreFull } from './lib/core/store.ts'
import { ready, registeredChanged } from './runtime.ts'

const ADD_PANE = 'secret-shield-add'
const LEARN_PANE = 'secret-shield-learn'

/** The values `/redact learn` found, by row id, in the worker's memory only. */
export const learnValues = new Map<string, string>()

async function today($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toISOString().slice(0, 10)
}

/** R-07: how many times a value is in this session's stored history. */
async function timesSent($: EngineInterface, value: string): Promise<number> {
  const rt = await ready($)
  const history = (await $.session.messages({ as: 'api' })) as unknown as { content: { type?: string }[] }[]
  const deadline = now() + 3000
  let n = 0
  for (const m of history) {
    const text = outboundText(m.content.filter(b => b.type !== 'image' && b.type !== 'document'))
    n += rt.redactor.findKnown(text, deadline).hits.filter(h => rt.redactor.valueOfTag(h.tag) === value).length
  }
  return n
}

function storeWords(error: unknown): string {
  return error instanceof StoreFull ? 'The list is full for this password store, so nothing was saved.' : 'The password store did not take it, so nothing was saved.'
}

async function submitAdd($: EngineInterface, value: string): Promise<void> {
  const note = { plugin: 'secret-shield', key: 'addNote' } as const
  const problem = validRegistered(value)
  if (problem) {
    await $.state.set(note, { text: `That value is ${problem}. It must be 6 to 8,192 characters.`, isError: true })
    return
  }
  const held = (await $.state.get(note)).value?.text
  const label = held?.startsWith('Label: ') ? held.slice(7) : 'registered'
  try {
    await addToList($, [{ value, label, added: await today($) }])
  } catch (error) {
    await $.state.set(note, { text: storeWords(error), isError: true })
    return
  }
  registeredChanged()
  const sent = await timesSent($, value).catch(() => 0)
  await $.ui.close({ id: ADD_PANE })
  $.ui.log(sent > 0 ? `secret-shield: saved. This value was already sent to the model ${sent} times this session. Consider rotating it.` : 'secret-shield: saved. It is hidden from now on.')
}

async function saveLearned($: EngineInterface): Promise<void> {
  const rows = (await $.state.get({ plugin: 'secret-shield', key: 'learnRows' })).value ?? []
  const added = await today($)
  const ticked = rows.filter(r => r.ticked).flatMap(r => {
    const value = learnValues.get(r.id)
    return value === undefined ? [] : [{ value, label: r.key, added }]
  })
  // The same rule as /redact add: a value under 6 characters would hide every "true" or "3000" it meets.
  const entries = ticked.filter(e => validRegistered(e.value) === undefined)
  const skipped = ticked.length - entries.length
  try {
    const saved = await addToList($, entries)
    learnValues.clear()
    registeredChanged()
    await $.ui.close({ id: LEARN_PANE })
    const already = entries.length - saved
    $.ui.log(
      `secret-shield: saved ${saved} of ${rows.length} values.` +
        (skipped > 0 ? ` ${skipped} skipped: a value must be 6 to 8,192 characters.` : '') +
        (already > 0 ? ` ${already} already saved.` : ''),
    )
  } catch (error) {
    await $.state.set({ plugin: 'secret-shield', key: 'learnNote' }, { text: storeWords(error), isError: true })
  }
}

async function toggle($: EngineInterface, id: string): Promise<void> {
  const key = { plugin: 'secret-shield', key: 'learnRows' } as const
  const rows = (await $.state.get(key)).value ?? []
  await $.state.set(key, rows.map(r => (r.id === id ? { ...r, ticked: !r.ticked } : r)))
}

export async function drawAdd($: EngineInterface, e: UiRenderInput) {
  const { Box, Input, Text } = $.ui.resolve(e) as never as Record<string, (...a: never[]) => never>
  // This surface has no text field.
  if (!Input) return <Text>Open this session on a computer to add a secret.</Text>
  const note = (await $.state.get({ plugin: 'secret-shield', key: 'addNote' })).value
  return (
    <Box flexDirection="column">
      <Text>Paste the secret and press Enter. It stays out of the chat. Esc cancels.</Text>
      <Input key="value" label="Secret: " autoFocus submitLabel="save" onSubmit={(value: string) => submitAdd($, value)} />
      {note ? <Text color={note.isError ? 'error' : undefined}>{note.text}</Text> : null}
    </Box>
  )
}

export async function drawLearn($: EngineInterface, e: UiRenderInput) {
  const { Box, Button, Text } = $.ui.resolve(e) as never as Record<string, (...a: never[]) => never>
  const rows = (await $.state.get({ plugin: 'secret-shield', key: 'learnRows' })).value ?? []
  const note = (await $.state.get({ plugin: 'secret-shield', key: 'learnNote' })).value
  return (
    <Box flexDirection="column">
      <Text>Tick what to remember. Values are not shown.</Text>
      {rows.slice(0, 200).map(r => (
        <Button key={r.id} plain label={`${r.ticked ? '[x]' : '[ ]'} ${r.key} (${r.length} characters) ${r.file}`} onPress={() => toggle($, r.id)} />
      ))}
      <Button key="save" variant="primary" label="Save" onPress={() => saveLearned($)} />
      {note ? <Text color={note.isError ? 'error' : undefined}>{note.text}</Text> : null}
    </Box>
  )
}
