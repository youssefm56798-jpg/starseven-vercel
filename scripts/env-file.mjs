/**
 * A minimal .env reader for scripts/setup-db.mjs.
 *
 * Hand-rolled on purpose: dotenv is not a dependency of this project, and Next
 * loads .env.local by itself at runtime — only the standalone setup script
 * needs this, so pulling in a package for it would not pay for itself.
 *
 * Deliberately conservative. It understands what .env.example actually uses:
 * KEY=VALUE, optional `export ` prefix, `#` comments, and quoted values.
 * It does not do variable interpolation or multi-line values.
 */

/**
 * @param {string} text contents of a .env file
 * @returns {Record<string,string>} parsed pairs, in file order
 */
export function parseEnv(text) {
  const out = {};

  for (let line of String(text ?? '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    // Ignore anything that is not a plausible shell variable name, so a stray
    // prose line with an `=` in it cannot inject a bogus key.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    const quote = value[0];

    if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      // Only double quotes carry escapes, matching dotenv.
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else {
      // Unquoted: an inline comment must be preceded by whitespace, so that a
      // value containing a bare '#' (a colour, say) survives intact.
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    out[key] = value;
  }

  return out;
}

/**
 * Applies a .env file to process.env without clobbering anything already set —
 * a real Vercel or CI environment must always win over a checked-out file.
 *
 * @returns {number} how many values were actually applied
 */
export function applyEnv(text, env = process.env) {
  let applied = 0;
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (env[key] === undefined) { env[key] = value; applied++; }
  }
  return applied;
}
