// Shapes shared across the checker. A Finding never holds the secret itself, so a
// secret can't reach a log through it.

export type Action = 'hide' | 'block' | 'warn'

export type Finding = {
  /** UTF-16 offsets into the scanned text. */
  start: number
  end: number
  ruleId: string
  /** What kind of secret, e.g. AWS_ACCESS_TOKEN (spec §9). */
  label: string
  kind: 'format' | 'label' | 'custom'
  action: Action
  /** False for password-label values: no last-4 hint (spec §9). */
  showHint: boolean
}

export type ScanResult = {
  findings: Finding[]
  /** False when the time budget ran out; the findings so far are still returned. */
  complete: boolean
}

export type RegexSpec = { source: string; flags: string }

export type AllowList = {
  /** What the regexes are tried against. */
  target: 'secret' | 'match' | 'line'
  regexes: RegexSpec[]
  stopwords: string[]
  /** Gitleaks' condition "AND": every listed check must agree. */
  and: boolean
}

export type CompiledRule = {
  id: string
  label: string
  source: string
  flags: string
  /** 0 means the first non-empty capture group, else the whole match (Gitleaks). */
  secretGroup: number
  /** Lowercased literals; the rule runs only near one of them. */
  keywords: string[]
  /** Characters to look at on each side of a keyword hit. */
  area: number
  spansLines: boolean
  entropy?: number
  /** Only applies to files whose path matches. */
  path?: RegexSpec
  /** A dropped leading [\w.-]{0,n}? : the allowlist target "match" still sees it. */
  /** The match counts only if this word comes before it, within this many characters. */
  requiresBefore?: { word: string; within: number }
  leadingContext?: { max: number; set: RegexSpec }
  allow: AllowList[]
  /** How the derived keywords compare with Gitleaks' own (build report only). */
  keywordNote?: string
}

export type Rejection = { id: string; reason: string }

export type RawAllowList = {
  regexTarget?: string
  regexes?: string[]
  stopwords?: string[]
  condition?: string
  paths?: string[]
}

export type RawRule = {
  id: string
  description?: string
  regex?: string
  entropy?: number
  keywords?: string[]
  secretGroup?: number
  path?: string
  allowlists?: RawAllowList[]
}
