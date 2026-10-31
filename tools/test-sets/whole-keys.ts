// Finds whole keys of well-known formats in text, for the repo guard test
// (tests/no-whole-fakes.test.ts). Reports labels only, never the match.

const PATTERNS: [label: string, re: RegExp][] = [
  ['github-pat', /\bghp_[0-9a-zA-Z]{36}\b/],
  ['gitlab-pat', /\bglpat-[\w-]{20}/],
  ['aws-access-key', /\bAKIA[A-Z2-7]{16}\b/],
  ['slack-bot', /\bxoxb-\d{10,13}-\d{10,13}/],
  ['stripe', /\b[sr]k_(?:test|live|prod)_[a-zA-Z0-9]{16,}\b/],
  ['databricks', /\bdapi[a-f0-9]{32}\b/],
  ['gcp', /\bAIza[\w-]{35}/],
  ['npm', /\bnpm_[a-z0-9]{36}\b/],
  ['private-key', /-----BEGIN[ A-Z]*PRIVATE KEY-----\s[A-Za-z0-9+/=\s]{64,}-----END/],
]

export function findWholeKeys(text: string): string[] {
  return PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => label)
}
