// The code set (plan 1b, spec 7.2, R-08): normal code and harmless values that
// must stay unhidden. Each case has a twin: the same spot holding a real-looking
// value, which must be hidden. The pair is what R-08 asks for.

export type CodeCase = {
  id: string
  /** Must be left alone. */
  text: string
  /** The same spot with a real-looking value: must be hidden. */
  twin: (value: string) => string
}

const assign = (label: string, sep = '=') => (value: string): string => `${label} ${sep} "${value}"\n`

const cases: [id: string, text: string, twin: CodeCase['twin']][] = [
  // Code, not values
  ['type-ts-string', 'function login(user: string, password: string) {}\n', v => `const password: string = "${v}"\n`],
  ['type-ts-number', 'type Retry = { token: number }\n', assign('token', ':')],
  ['type-ts-boolean', 'interface Opts { secret: boolean }\n', assign('secret', ':')],
  ['type-py-str', 'def login(password: str) -> bool:\n', assign('password', ':')],
  ['type-py-int', 'token: int = 0\n', assign('token')],
  ['type-py-bool', 'secret: bool = False\n', assign('secret')],
  ['type-py-bytes', 'api_key: bytes\n', assign('api_key', ':')],
  ['type-py-optional', 'secret: Optional[str] = None\n', assign('secret')],
  ['type-py-secretstr', 'password: SecretStr\n', assign('password', ':')],
  ['type-java-string', 'private String password;\n', assign('password')],
  ['call-get-token', 'token = getToken()\n', assign('token')],
  ['prop-config', 'password = config.password\n', assign('password')],
  ['prop-self', 'secret = self.secret\n', assign('secret')],
  ['prop-args', 'token = args.token\n', assign('token')],
  ['same-name', 'password = password\n', assign('password')],
  // Python's pass statement and prose
  ['py-pass-statement', 'if retry:\n    pass\n', v => `pass = "${v}"\n`],
  ['prose-password', 'The password must be at least 8 characters long.\n', v => `The password: ${v}\n`],
  ['prose-token', 'Pass the token to the function and check it.\n', v => `token: ${v}\n`],
  // Variable references
  ['var-shell-braces', 'password=${VAR}\n', v => `password=${v}\n`],
  ['var-shell', 'password=$VAR\n', v => `password=${v}\n`],
  ['var-windows', 'password=%VAR%\n', v => `password=${v}\n`],
  ['var-template', 'password: {{ var }}\n', v => `password: ${v}\n`],
  ['var-github-actions', 'token: ${{ secrets.X }}\n', v => `token: ${v}\n`],
  ['var-process-env', 'const token = process.env.X\n', assign('const token')],
  ['var-os-environ', 'api_key = os.environ["API_KEY"]\n', assign('api_key')],
  ['var-os-getenv', 'password = os.getenv("DB_PASSWORD")\n', assign('password')],
  ['var-system-getenv', 'String token = System.getenv("TOKEN");\n', assign('String token')],
  ['var-ruby-env', 'secret = ENV["SECRET"]\n', assign('secret')],
  // Placeholders
  ['placeholder-your-password', 'password=your-password-here\n', v => `password=${v}\n`],
  ['placeholder-angle', 'password=<password>\n', v => `password=${v}\n`],
  ['placeholder-stars', 'password=********\n', v => `password=${v}\n`],
  ['placeholder-x', 'password=xxxxxx\n', v => `password=${v}\n`],
  ['placeholder-changeme', 'password=changeme\n', v => `password=${v}\n`],
  ['placeholder-example', 'password=example\n', v => `password=${v}\n`],
  ['placeholder-dummy', 'password=dummy\n', v => `password=${v}\n`],
  ['placeholder-test', 'password=test\n', v => `password=${v}\n`],
  ['placeholder-null', 'password=null\n', v => `password=${v}\n`],
  ['placeholder-none', 'password=none\n', v => `password=${v}\n`],
  ['placeholder-empty', 'password=\n', v => `password=${v}\n`],
  // Documented example keys and URLs without a password
  ['documented-example-key', `aws_access_key_id = ${'AK' + 'IA' + 'IOSFODNN7' + 'EXAMPLE'}\n`, v => `aws_access_key_id = ${v}\n`],
  ['db-url-no-password', 'DATABASE_URL=postgres://db.internal:5432/app\n', v => `DATABASE_URL=postgres://app:${v}@db.internal:5432/app\n`],
]

export function codeSet(): CodeCase[] {
  return cases.map(([id, text, twin]) => ({ id, text, twin }))
}
