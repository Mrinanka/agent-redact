// The outbound check (spec §11): a last safety net before a command, web request or connected tool
// runs. Anything that isn't known to stay on this machine is checked, so a new tool is covered by default.

const LOCAL_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'LS', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode', 'ToolSearch', 'Skill'])
const ENVELOPE = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'])
const MAX_DEPTH = 32

export type OutboundSetting = 'block' | 'ask' | 'warn' | 'off'
export type OutboundVerdict = 'go' | 'block' | 'ask' | 'warn'

export const isChecked = (tool: string): boolean => !LOCAL_TOOLS.has(tool)

/** Every string in a tool's arguments, one per line. */
export function outboundText(input: unknown): string {
  const out: string[] = []
  const seen = new Set<object>()
  const walk = (v: unknown, depth: number): void => {
    if (typeof v === 'string') out.push(v)
    else if (typeof v === 'object' && v !== null && depth < MAX_DEPTH && !seen.has(v)) {
      seen.add(v)
      for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1)
    }
  }
  if (typeof input === 'object' && input !== null) {
    seen.add(input)
    for (const [k, v] of Object.entries(input)) if (!ENVELOPE.has(k)) walk(v, 0)
  } else walk(input, 0)
  return out.join('\n')
}

export function outboundVerdict(setting: OutboundSetting, hits: readonly unknown[]): OutboundVerdict {
  if (hits.length === 0 || setting === 'off') return 'go'
  return setting
}
