// What the step 4 hooks keep for the session in the host's memory, so a restarted worker has it. None
// of it is a value: tags, labels, redacted file names and counts only.

import type { EngineInterface } from 'claude-code'
import type { ShieldGuardPass, ShieldHidden, ShieldPlaced, ShieldResume } from '../types'

const MAX_LIST = 500

export async function resumeState($: EngineInterface): Promise<ShieldResume | undefined> {
  const { value } = await $.state.get({ plugin: 'secret-shield', key: 'resume' })
  return value
}

export async function setResumeState($: EngineInterface, value: ShieldResume): Promise<void> {
  await $.state.set({ plugin: 'secret-shield', key: 'resume' }, value)
}

export async function allowedTags($: EngineInterface): Promise<string[]> {
  const { value } = await $.state.get({ plugin: 'secret-shield', key: 'allowed' })
  return value ?? []
}

export async function addAllowedTag($: EngineInterface, tag: string): Promise<void> {
  await $.state.set({ plugin: 'secret-shield', key: 'allowed' }, [...(await allowedTags($)), tag])
}

export async function guardPass($: EngineInterface): Promise<ShieldGuardPass | undefined> {
  const { value } = await $.state.get({ plugin: 'secret-shield', key: 'guardPass' })
  return value ?? undefined
}

export async function setGuardPass($: EngineInterface, value: ShieldGuardPass | null): Promise<void> {
  await $.state.set({ plugin: 'secret-shield', key: 'guardPass' }, value)
}

export async function placedFiles($: EngineInterface): Promise<ShieldPlaced[]> {
  const { value } = await $.state.get({ plugin: 'secret-shield', key: 'placed' })
  return value ?? []
}

export async function addPlaced($: EngineInterface, list: ShieldPlaced[]): Promise<void> {
  await $.state.set({ plugin: 'secret-shield', key: 'placed' }, [...(await placedFiles($)), ...list].slice(-MAX_LIST))
}

export async function hiddenSummary($: EngineInterface): Promise<ShieldHidden[]> {
  const { value } = await $.state.get({ plugin: 'secret-shield', key: 'hidden' })
  return value ?? []
}

export async function addHidden($: EngineInterface, list: ShieldHidden[]): Promise<void> {
  const known = await hiddenSummary($)
  const fresh = list.filter(h => !known.some(k => k.tag === h.tag && k.where === h.where))
  if (fresh.length > 0) await $.state.set({ plugin: 'secret-shield', key: 'hidden' }, [...known, ...fresh].slice(-MAX_LIST))
}
