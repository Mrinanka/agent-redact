// A settings hook for the leak test: adds the file named on its command line to
// the conversation as hook context (spec 5.1, check 0.1). Run on UserPromptSubmit.

import fs from 'node:fs'

const additionalContext = fs.readFileSync(process.argv[2], 'utf8')
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }))
