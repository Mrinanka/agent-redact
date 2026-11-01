// Shannon entropy as Gitleaks computes it (detect/utils.go): counts per character,
// divided by the length in UTF-8 bytes.
export function shannon(data) {
    if (data.length === 0)
        return 0;
    const counts = new Map();
    let bytes = 0;
    for (let i = 0; i < data.length; i++) {
        let code = data.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < data.length) {
            const next = data.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                i++;
            }
        }
        // A lone surrogate is counted as the replacement character, as Go does for invalid text.
        if (code >= 0xd800 && code <= 0xdfff)
            code = 0xfffd;
        bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
        counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const inv = 1 / bytes;
    let h = 0;
    for (const n of counts.values()) {
        const f = n * inv;
        h -= f * Math.log2(f);
    }
    return h;
}
