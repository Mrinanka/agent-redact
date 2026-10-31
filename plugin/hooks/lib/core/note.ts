// The note added to Claude's instructions (spec §9). It must be the same for the whole thread, so it is
// a fixed string: changing it later would break the prompt cache.

export const NOTE_ID = 'secret-shield:placeholders'

export const PLACEHOLDER_NOTE = [
  'Some values in this conversation are hidden. A hidden value shows as a placeholder such as [REDACTED:LABEL ...last4 #tag]: the label says what kind of value it was and the tag identifies it. A placeholder is not an error. The real value is not available to you.',
  '',
  '- Do not ask for a hidden value and do not try to guess it.',
  '- Do not use the Edit tool on a line that contains a placeholder. If you must rewrite a whole file, keep each line that holds a placeholder exactly as it is.',
  '- When a real value is needed, say which placeholder and ask the user to fill it in themselves.',
  '- Where you mean the same value, write the same placeholder.',
].join('\n')
