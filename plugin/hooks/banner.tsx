// The permanent observe-mode banner (spec §13, R-13). A `-p` run draws nothing, so there the log and
// the mode in `/redact` are all there is (progress, Known issues).

import type { EngineInterface, UiRenderInput } from 'claude-code'
import { observing, OBSERVE_BANNER } from './handlers.ts'

export async function drawBanner($: EngineInterface, e: UiRenderInput, next: (e: UiRenderInput) => unknown) {
  if (!(await observing($))) return next(e)
  const { Text } = $.ui.resolve(e) as never as Record<string, (...a: never[]) => never>
  return <Text color="warning">secret-shield: {OBSERVE_BANNER}</Text>
}
