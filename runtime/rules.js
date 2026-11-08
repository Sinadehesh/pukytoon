// Win and lose rules: small expressions over a game's numbers, such as "score >= 500" or
// "lives <= 0 || time >= 90". Read by a tiny parser, never by eval: only numbers, the game's own variable
// names, + - * / %, comparisons, && || ! and brackets.

export class RuleError extends Error {}

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(&&|\|\||[<>!=]=|[-+*/%<>!()]))/y;
const POWER = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
const OPS = {
    '||': (a, b) => v => (a(v) || b(v) ? 1 : 0),
    '&&': (a, b) => v => (a(v) && b(v) ? 1 : 0),
    '==': (a, b) => v => (a(v) === b(v) ? 1 : 0),
    '!=': (a, b) => v => (a(v) !== b(v) ? 1 : 0),
    '<': (a, b) => v => (a(v) < b(v) ? 1 : 0),
    '<=': (a, b) => v => (a(v) <= b(v) ? 1 : 0),
    '>': (a, b) => v => (a(v) > b(v) ? 1 : 0),
    '>=': (a, b) => v => (a(v) >= b(v) ? 1 : 0),
    '+': (a, b) => v => a(v) + b(v),
    '-': (a, b) => v => a(v) - b(v),
    '*': (a, b) => v => a(v) * b(v),
    '/': (a, b) => v => a(v) / b(v),
    '%': (a, b) => v => a(v) % b(v)
};

// Returns a function vars -> true/false, or null for an empty rule (the game never ends that way).
// Throws RuleError with a message people can act on.
export function compileRule(text, names) {
    if (text == null || String(text).trim() === '') return null;
    const src = String(text);
    if (src.length > 200) throw new RuleError('That rule is too long (200 characters at most)');

    const tokens = [];
    let pos = 0;
    while (pos < src.length) {
        if (!src.slice(pos).trim()) break;
        TOKEN.lastIndex = pos;
        const m = TOKEN.exec(src);
        if (!m) {
            const rest = src.slice(pos).trim();
            throw new RuleError(rest.startsWith('=') ? 'Use == to compare (or >=, <=)' : `Can't read "${rest.slice(0, 12)}"`);
        }
        pos = TOKEN.lastIndex;
        if (m[1]) tokens.push({ num: parseFloat(m[1]) });
        else if (m[2]) {
            if (!names.includes(m[2])) throw new RuleError(`"${m[2]}" isn't something this game counts. Use: ${names.join(', ')}`);
            tokens.push({ name: m[2] });
        } else tokens.push({ op: m[3] });
    }

    let i = 0;
    const prefix = () => {
        const t = tokens[i++];
        if (!t) throw new RuleError('The rule stops too early');
        if ('num' in t) return () => t.num;
        if ('name' in t) return vars => Number(vars[t.name]) || 0;
        if (t.op === '(') {
            const inner = expression(0);
            if (!tokens[i] || tokens[i].op !== ')') throw new RuleError('A bracket is missing its ")"');
            i++;
            return inner;
        }
        if (t.op === '!') { const e = expression(7); return v => (e(v) ? 0 : 1); }
        if (t.op === '-') { const e = expression(7); return v => -e(v); }
        throw new RuleError(`"${t.op}" can't go there`);
    };
    const expression = minPower => {
        let left = prefix();
        for (;;) {
            const t = tokens[i];
            if (!t || !('op' in t) || !(t.op in POWER) || POWER[t.op] <= minPower) return left;
            i++;
            left = OPS[t.op](left, expression(POWER[t.op]));
        }
    };

    const fn = expression(0);
    if (i < tokens.length) throw new RuleError(`"${tokens[i].op ?? tokens[i].name ?? tokens[i].num}" can't go there`);
    return vars => !!fn(vars);
}

// "score >= 500 && lives > 0" -> "score ≥ 500 and lives > 0", for title screens and the Studio
export function describeRule(text) {
    return String(text || '')
        .replace(/>=/g, '≥').replace(/<=/g, '≤').replace(/!=/g, '≠').replace(/==/g, '=')
        .replace(/&&/g, 'and').replace(/\|\|/g, 'or').replace(/\s+/g, ' ').trim();
}
