/**
 * Splits a .sql file into individual statements.
 *
 * Why this exists: the Neon HTTP driver sends one statement per request, so
 * schema.sql and seed.sql have to be broken up client-side — and a naive
 * `sql.split(';')` corrupts this project's seed, which carries semicolons and
 * apostrophes inside multi-line Arabic and English article bodies.
 *
 * The scanner therefore tracks every context in which a `;` is *not* a
 * statement terminator: single-quoted literals (with '' escaping), E'' escape
 * strings (with backslash escaping), double-quoted identifiers, dollar-quoted
 * bodies, line comments and block comments.
 *
 * Kept in its own module, with no dependencies, so tests/sql-split.test.mjs can
 * exercise it without a database or a network.
 */

const BACKSLASH = String.fromCharCode(92);

/** True when the token immediately before the quote makes it an E'' string. */
function isEscapeStringStart(src, quoteIdx) {
  const prev = src[quoteIdx - 1];
  if (prev !== 'E' && prev !== 'e') return false;
  const before = src[quoteIdx - 2];
  // `E'..'` only counts when the E stands alone, not as the tail of `TRUE'`.
  return before === undefined || !/[A-Za-z0-9_$]/.test(before);
}

/** Everything a comment contributes is whitespace as far as emptiness goes. */
function withoutComments(stmt) {
  return stmt
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * @param {string} sql raw file contents
 * @returns {string[]} trimmed statements, comment-only chunks dropped
 */
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  const n = sql.length;

  const flush = () => {
    const stmt = buf.trim();
    // A chunk that is nothing but comments (the file headers) is not a
    // statement — sending it to Postgres would be an empty-query error.
    if (stmt && withoutComments(stmt).trim() !== '') out.push(stmt);
    buf = '';
  };

  while (i < n) {
    const c = sql[i];

    // ---- line comment: runs to end of line, semicolons inside are inert
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') { buf += sql[i]; i++; }
      continue;
    }

    // ---- block comment (Postgres nests them, so track the depth)
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 0;
      while (i < n) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; buf += '/*'; i += 2; continue; }
        if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--; buf += '*/'; i += 2;
          if (depth === 0) break;
          continue;
        }
        buf += sql[i]; i++;
      }
      continue;
    }

    // ---- dollar-quoted body: $$ ... $$ or $tag$ ... $tag$
    if (c === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const open = tag[0];
        const close = sql.indexOf(open, i + open.length);
        const stop = close === -1 ? n : close + open.length;
        buf += sql.slice(i, stop);
        i = stop;
        continue;
      }
      buf += c; i++;
      continue;
    }

    // ---- single-quoted literal (may span lines; '' is a literal quote)
    if (c === "'") {
      const escapeString = isEscapeStringStart(sql, i);
      buf += c; i++;
      while (i < n) {
        if (escapeString && sql[i] === BACKSLASH) { buf += sql.slice(i, i + 2); i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { buf += "''"; i += 2; continue; }
          buf += "'"; i++; break;
        }
        buf += sql[i]; i++;
      }
      continue;
    }

    // ---- double-quoted identifier ("" is a literal double quote)
    if (c === '"') {
      buf += c; i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { buf += '""'; i += 2; continue; }
          buf += '"'; i++; break;
        }
        buf += sql[i]; i++;
      }
      continue;
    }

    if (c === ';') { flush(); i++; continue; }

    buf += c; i++;
  }

  flush(); // a trailing statement without its semicolon still counts
  return out;
}
