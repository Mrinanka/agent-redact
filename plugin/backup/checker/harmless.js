// Harmless values (spec §7.2): values that follow a password label but are not
// secrets. Each rule here has a test showing it is left alone and a twin test
// showing a real-looking value in the same spot is hidden (R-08).
/** Extensions where a bare identifier after a label is code, not a value. */
const SOURCE_EXTENSIONS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'kt', 'kts', 'go', 'rs', 'rb', 'php', 'cs', 'c', 'h', 'cc', 'cpp', 'hpp',
    'swift', 'scala', 'dart', 'lua', 'm',
]);
export function isSourceFile(file) {
    if (!file)
        return false;
    const base = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
    const dot = base.lastIndexOf('.');
    return dot > 0 && SOURCE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}
const PLACEHOLDER_WORDS = new Set([
    'changeme', 'change-me', 'change_me', 'changeit', 'example', 'dummy', 'test', 'null', 'none', 'nil', 'undefined', 'redacted',
    'placeholder', 'password', 'todo', 'fixme', 'tbd',
]);
export function isPlaceholder(v) {
    if (v === '')
        return true;
    const lower = v.toLowerCase();
    if (PLACEHOLDER_WORDS.has(lower))
        return true;
    if (/^your[-_ ][a-z_ -]*$/i.test(v))
        return true;
    if (/^<[^<>]*>$/.test(v))
        return true;
    if (/^\*+$/.test(v) || /^x+$/i.test(v) || /^\.+$/.test(v) || /^-+$/.test(v))
        return true;
    if (v.startsWith('[REDACTED'))
        return true;
    return false;
}
export function isVariableRef(v) {
    return (/^\$\{[^{}]*\}$/.test(v) || // ${VAR}
        /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v) || // $VAR
        /^%[^%\s]+%$/.test(v) || // %VAR%
        /^\{\{.*\}\}$/.test(v) || // {{ var }}
        /^\$\{\{.*\}\}$/.test(v) || // ${{ secrets.X }}
        /^@[A-Za-z_][A-Za-z0-9_]*@$/.test(v) || // @VAR@
        /^\$\([^()]*\)$/.test(v) // $(command)
    );
}
const TYPE_NAMES = new Set([
    'string', 'str', 'number', 'int', 'integer', 'bool', 'boolean', 'bytes', 'secretstr', 'float', 'double', 'long', 'char', 'object',
    'any', 'unknown', 'void',
]);
export function isTypeName(v) {
    const lower = v.toLowerCase();
    return TYPE_NAMES.has(lower) || /^optional\[.*\]$/i.test(v);
}
const IDENT = '[A-Za-z_$][\\w$]*';
const CALL_OR_INDEX = new RegExp(`^${IDENT}(?:\\.${IDENT})*(?:\\(.*\\)|\\[.*\\])[;:,)]*$`);
const PROPERTY = new RegExp(`^${IDENT}(?:\\.${IDENT})+$`);
// A generic type, as in Token<SyntaxKind.DotToken>
const GENERIC = new RegExp(`^${IDENT}(?:\\.${IDENT})*<[\\w$.<>,\\[\\] ]*>?$`);
const ENV_LOOKUP = /^(?:process\.env|import\.meta\.env)\.[\w$]+$/;
/** `getToken()`, `os.environ["X"]`, `ENV["X"]`. A password can't pass for these unless it closes its bracket. */
export const isCall = (v) => CALL_OR_INDEX.test(v);
const norm = (s) => s.toLowerCase().replace(/[-_. ]/g, '');
/** `config.password`, `self.secret`: a dotted value that ends in its own label. */
function endsInLabel(v, label) {
    if (!PROPERTY.test(v))
        return false;
    const last = norm(v.slice(v.lastIndexOf('.') + 1));
    const name = norm(label);
    return last.includes(name) || name.includes(last);
}
export function isHarmless(value, ctx) {
    if (isPlaceholder(value) || isVariableRef(value))
        return true;
    if (norm(value) === norm(ctx.label))
        return true;
    if (ctx.quoted)
        return false; // a quoted value is never treated as code
    const t = ctx.token;
    if (isTypeName(value) || isTypeName(t))
        return true;
    if (isCall(t) || ENV_LOOKUP.test(value) || endsInLabel(value, ctx.label))
        return true;
    // These read as code only when the text is known to be code. In a .env file they are passwords.
    if (!isSourceFile(ctx.file))
        return false;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || PROPERTY.test(value) || GENERIC.test(t);
}
/** A value that looks generated: long enough and mixing character classes. */
export function looksRandom(v) {
    if (v.length < 12)
        return false;
    let classes = 0;
    if (/[a-z]/.test(v))
        classes++;
    if (/[A-Z]/.test(v))
        classes++;
    if (/[0-9]/.test(v))
        classes++;
    if (/[^A-Za-z0-9]/.test(v))
        classes++;
    return classes >= 3 || (classes >= 2 && /[0-9]/.test(v) && v.length >= 20);
}
