/**
 * The on-disk shape of a backup, and nothing else.
 *
 * Kept in its own module for the same reason scripts/sql-split.mjs is: the
 * decisions here are the ones that decide whether a restore works, and they can
 * all be exercised with no database and no network. tests/backup-format.test.mjs
 * does exactly that, which matters because the alternative — finding out the
 * encoder mangles an Arabic address only when somebody restores at 2am — is the
 * failure mode this whole exercise exists to remove.
 *
 * ---------------------------------------------------------------------------
 *  Why NDJSON and not SQL
 *
 *  The obvious dump format is a file of INSERT statements, because that is what
 *  pg_dump writes and it restores with psql and no code at all. It was written
 *  that way first and thrown away, for two reasons.
 *
 *  psql is not on this machine and neither is pg_dump — see the probe in
 *  scripts/backup-db.mjs. A .sql file that nothing in the toolchain can replay
 *  is a file, not a backup. Whatever this project writes has to be restorable by
 *  the one Postgres client it definitely has, which is @neondatabase/serverless.
 *
 *  And writing SQL means quoting values by hand. Every value in this database
 *  that is interesting is also hostile to a hand-rolled quoter: Arabic prose
 *  with embedded apostrophes, addresses with newlines in them, JSON, NUMERIC
 *  that must not become a float. One escaping bug there is silent data
 *  corruption that only shows up in the restored copy. With NDJSON the values
 *  never re-enter SQL as text — they go back through the driver as bind
 *  parameters, where the quoting is the driver's problem and it has already
 *  solved it.
 *
 * ---------------------------------------------------------------------------
 *  Why every value is a string
 *
 *  The dump asks Postgres for `column::text` and stores exactly what comes back.
 *  It does not store the driver's idea of the value.
 *
 *  That is not fussiness. The driver parses a DATE into a JavaScript Date at
 *  LOCAL midnight. Serialise that to JSON and you get an ISO instant in UTC —
 *  which, from Cairo, is 21:00 or 22:00 the PREVIOUS day. Feed it back into a
 *  DATE column and every delivery window in the shop moves a day earlier. The
 *  same driver returns NUMERIC as a string but BIGINT as a string and INT as a
 *  number, so a format that trusted the driver's types would need a per-column
 *  table of exceptions that goes stale the first time a column changes type.
 *
 *  `::text` sidesteps all of it. What Postgres prints, Postgres can read back:
 *  timestamptz carries its offset, numeric keeps its scale, boolean is
 *  'true'/'false', and NULL stays a JSON null, distinct from the empty string —
 *  which this schema uses everywhere and which must not be confused with it.
 *
 * ---------------------------------------------------------------------------
 *  The file
 *
 *    line 1        manifest object  { nssBackup: 1, generatedAt, ... }
 *    then, per table:
 *      a header    { table: "orders", columns: [...] }
 *      then rows   ["1", "S7-1042", null, ...]   values in column order
 *    last line     footer  { end: true, counts: {...}, sha256: "..." }
 *
 *  Object vs array is what tells a header from a row, so no line needs a type
 *  tag. One JSON document per line means a truncated dump loses whole rows
 *  rather than producing one unparseable half-row, and it means `head`, `grep`
 *  and `wc -l` all work on it — which is the property that made plain NDJSON
 *  win over a gzipped anything. This shop's whole dataset is megabytes; the disk
 *  saved is worth less than being able to read the file with no tool at 2am.
 *
 *  The footer is the part that earns its place. A backup that silently stops
 *  half way — a disk filling, a process killed, a network read that ended early
 *  — is the classic way a backup turns out not to be one, and it is invisible:
 *  the file opens, the first rows look right. A restore here refuses any dump
 *  whose last line is not a footer, whose per-table counts do not match what it
 *  actually read, or whose body does not hash to the recorded digest. A dump
 *  that was cut off cannot be quietly half-restored.
 */

import { createHash } from 'node:crypto';

/** Bumped only if the layout above changes in a way a reader must know about. */
export const BACKUP_VERSION = 1;

/**
 * What gets dumped, in the order it must be restored.
 *
 * Parents before children, because order_items, order_events and order_tokens
 * all carry `REFERENCES orders(id) ON DELETE CASCADE`, and admin_recovery_codes
 * references admins. Restoring a child first fails on the foreign key, which is
 * at least loud — but only if the order is right by accident on every run, so
 * it is fixed here instead.
 *
 * `pk` is the column the dump pages on. Every table here has a single-column
 * primary key, and paging on it with `WHERE pk > $1 ORDER BY pk` rather than
 * OFFSET means the cost of reading page N does not grow with N. On a table the
 * size orders is heading for, OFFSET paging spends most of a backup re-walking
 * rows it has already emitted.
 *
 * ---------------------------------------------------------------------------
 *  What is in this list, and what a restore would genuinely lose without it
 *
 *  The test for every table below is the same: if this row is gone, can it be
 *  reconstructed from something that IS in git? db/schema.sql and db/seed.sql
 *  are in git and are re-applied on every deploy, so anything they produce is
 *  not worth a backup. Everything else is.
 *
 *  orders, order_items          The business. Nothing else in the world holds
 *                              them. A cash-on-delivery shop that loses these
 *                              does not know who is owed a parcel or who owes
 *                              it money.
 *
 *  order_events                 The timeline the customer sees and the audit
 *                              log the shop answers complaints with. Losing it
 *                              leaves orders whose status nobody can explain.
 *
 *  order_tokens                 The credential. The token in each confirmation
 *                              email exists nowhere but that inbox and this
 *                              table holds its only digest, so losing this
 *                              table breaks every order link already sent and
 *                              they cannot be reissued to the same value —
 *                              only replaced, which means emailing every
 *                              customer who ever ordered.
 *
 *  subscribers                  A mailing list, with confirmation state. Not
 *                              reconstructible, and re-collecting consent is
 *                              not something a restore can do.
 *
 *  offers                       db/seed.sql carries exactly one coupon, STAR10.
 *                              Every code the owner has created since, and —
 *                              more importantly — every used_count, lives only
 *                              here. Restoring offers from the seed alone would
 *                              hand back a fresh redemption budget on every
 *                              capped code in the shop.
 *
 *  offer_redemptions            The same argument one level down, and the
 *                              reason it is not enough to keep offers alone.
 *                              used_count says how many redemptions a code has
 *                              left; this says which customers have had theirs.
 *                              Losing it resets every per-customer cap in the
 *                              shop to zero — a "first order only" code becomes
 *                              usable again by everybody who has already used
 *                              it, and the restore would look clean while doing
 *                              it, because used_count would still be right.
 *
 *  products                     The subtle one. db/seed.sql does recreate all
 *                              63 rows, so a naive reading says skip it. But
 *                              the seed is INSERT ... ON CONFLICT DO NOTHING,
 *                              which is what makes it safe to re-run and also
 *                              what makes it useless as a restore: it recreates
 *                              the products as they SHIPPED — 55 of them
 *                              inactive at price 0 — and then declines to touch
 *                              the price, stock, active and featured flags the
 *                              owner has been editing in the admin ever since.
 *                              Restoring from the seed would silently unprice
 *                              the catalogue.
 *
 *  admins                       Without this nobody can log in to fix anything.
 *                              Contains the password hash, the encrypted TOTP
 *                              secret and session_epoch. /admin/setup only
 *                              works while no admin exists, so a restore that
 *                              omits this table cannot even bootstrap a new one
 *                              unless ADMIN_SETUP_KEY is put back — and step 5
 *                              of docs/DEPLOY.md tells you to delete it.
 *
 *  admin_recovery_codes         The way back in when the second-factor phone is
 *                              gone. Useless without the admins row it points
 *                              at, which is why it sits directly after it.
 *
 *  settings                     The honest answer here is that nothing reads or
 *                              writes this table today — db/schema.sql creates
 *                              it on every deploy and it is empty. It is in the
 *                              backup set anyway, and deliberately: it is one
 *                              row per key, so it costs bytes rather than
 *                              anything real, and the day somebody builds the
 *                              reader it was designed for, its contents stop
 *                              being reconstructible from git. A backup set that
 *                              has to be remembered and extended on that day is
 *                              a backup set that will not be.
 *
 * ---------------------------------------------------------------------------
 *  What is deliberately NOT here
 *
 *  articles                     db/seed.sql carries every article body in both
 *                              languages and re-applies them on every deploy,
 *                              and there is no admin screen that edits them —
 *                              see the note in docs/HANDOFF.md. The one thing
 *                              lost is articles.views, a vanity counter. If an
 *                              article editor is ever built, this table moves
 *                              into the list above on the same day.
 *
 *  rate_limits                  Fixed windows, seconds to hours old. Restoring
 *                              them would be worse than losing them: it
 *                              reinstates stale windows that either lock out a
 *                              customer for an hour or hand an attacker a
 *                              window that has already been half spent.
 *
 *  order_attempts               Checkout idempotency keys, deleted after 30
 *                              days by db/schema.sql on every deploy. There is
 *                              one real cost to skipping it, and it is small
 *                              and brief: a customer whose checkout is in
 *                              flight across the restore can retry and get a
 *                              second order rather than the original reply.
 *                              That window is seconds wide and the alternative
 *                              is carrying an expiring cache in every backup.
 *
 *  email_log, quiz_results      Operational logs and funnel analytics. Neither
 *                              is reconstructible and neither is the business;
 *                              losing them costs a reporting gap, not an order.
 *                              Named here so that skipping them is a decision
 *                              on the record rather than an oversight.
 *
 *  the schema itself            db/schema.sql is in git and `npm run db:setup`
 *                              applies it. A dump that carried its own DDL
 *                              would immediately have two schemas that can
 *                              disagree. What the manifest records instead is a
 *                              digest of the schema file the dump was taken
 *                              against, so a restore can say out loud that the
 *                              shapes have moved apart — see checkColumns().
 */
export const TABLES = [
  { name: 'settings', pk: 'key' },
  { name: 'admins', pk: 'id' },
  { name: 'admin_recovery_codes', pk: 'id' },
  { name: 'products', pk: 'id' },
  { name: 'offers', pk: 'id' },
  { name: 'subscribers', pk: 'id' },
  { name: 'orders', pk: 'id' },
  { name: 'order_items', pk: 'id' },
  { name: 'order_events', pk: 'id' },
  { name: 'order_tokens', pk: 'id' },
  { name: 'offer_redemptions', pk: 'id' },
];

export const TABLE_NAMES = TABLES.map(t => t.name);

/**
 * Builds the dump's file name.
 *
 * UTC, and sortable: `ls` puts them in age order without anybody having to
 * think about it, and a name built from local time would reorder itself twice a
 * year — an hour of dumps every autumn that sort before the ones taken before
 * them. The colons a plain ISO string carries are illegal in a Windows filename
 * and awkward in a shell everywhere else, so they become hyphens rather than
 * disappearing: 140322 and 14-03-22 sort identically, and only one of them can
 * be read at a glance by somebody who has been awake since midnight.
 */
export function dumpFileName(at = new Date()) {
  const stamp = at.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
  return `starseven-${stamp}.ndjson`;
}

const NEWLINE = String.fromCharCode(10);

/**
 * Writes the lines of a dump and keeps the running digest and counts that the
 * footer asserts. It returns strings rather than touching a file, so the same
 * object is used by the backup script against a real stream and by the tests
 * against an array.
 */
export class DumpWriter {
  constructor() {
    this.hash = createHash('sha256');
    this.counts = {};
    this.table = null;
    this.done = false;
  }

  #line(value) {
    const text = JSON.stringify(value) + NEWLINE;
    this.hash.update(text);
    return text;
  }

  /** The first line. Not hashed: the digest covers the body it describes. */
  manifest(fields) {
    return JSON.stringify({ nssBackup: BACKUP_VERSION, ...fields }) + NEWLINE;
  }

  /** Starts a table block. Columns are fixed for every row that follows. */
  begin(table, columns) {
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new Error(`${table}: a table block needs at least one column`);
    }
    if (this.counts[table] !== undefined) {
      throw new Error(`${table}: written twice`);
    }
    this.table = { name: table, width: columns.length };
    this.counts[table] = 0;
    return this.#line({ table, columns });
  }

  /**
   * One row, as values in column order.
   *
   * The width check is here rather than at the reader because a dump that is
   * wrong is worth catching while the source database is still open, not on the
   * night somebody needs to read it back.
   */
  row(values) {
    if (!this.table) throw new Error('row() before begin()');
    if (!Array.isArray(values) || values.length !== this.table.width) {
      throw new Error(
        `${this.table.name}: row has ${values?.length} value(s), expected ${this.table.width}`
      );
    }
    this.counts[this.table.name]++;
    return this.#line(values);
  }

  /** The last line. Everything after it is corruption. */
  finish() {
    this.done = true;
    return JSON.stringify({
      end: true,
      counts: this.counts,
      sha256: this.hash.copy().digest('hex'),
    }) + NEWLINE;
  }
}

/**
 * Reads a dump one line at a time.
 *
 * Line at a time, and not JSON.parse of the whole file, because the file this
 * has to survive is the one taken on the worst day — the biggest one, from the
 * busiest shop. Holding 200k orders in memory as parsed JavaScript objects to
 * insert them 200 at a time is a waste that turns into an out-of-memory crash
 * on exactly the run that must not crash.
 *
 * The caller drives it: push() every line, then finish(). Nothing here reads a
 * file or opens a socket, so the tests feed it a string.
 */
export class DumpReader {
  /**
   * @param {object} handlers
   * @param {(manifest: object) => void} [handlers.onManifest]
   * @param {(table: string, columns: string[]) => void} [handlers.onTable]
   * @param {(values: (string|null)[]) => (void|Promise<void>)} [handlers.onRow]
   */
  constructor(handlers = {}) {
    this.on = handlers;
    this.hash = createHash('sha256');
    this.manifest = null;
    this.footer = null;
    this.table = null;
    this.counts = {};
    this.lineNo = 0;
  }

  /**
   * Feeds one line. Returns a promise only when the row handler does, so the
   * restore can await its batch flush and the tests can ignore it.
   */
  push(raw) {
    const line = raw.replace(/\r$/, '');
    this.lineNo++;
    if (line.trim() === '') return;                // a trailing newline is not a row
    if (this.footer) throw new Error(`line ${this.lineNo}: content after the footer`);

    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`line ${this.lineNo}: not valid JSON`);
    }

    if (this.manifest === null) {
      if (Array.isArray(value) || !value || value.nssBackup === undefined) {
        throw new Error('this file does not start with a New Star Seven backup manifest');
      }
      if (value.nssBackup !== BACKUP_VERSION) {
        throw new Error(
          `dump is format version ${value.nssBackup}; this build reads version ${BACKUP_VERSION}`
        );
      }
      this.manifest = value;
      return this.on.onManifest?.(value);
    }

    if (value && value.end === true && !Array.isArray(value)) {
      this.footer = value;
      return;
    }

    // Hashed after the footer test, not before. The digest covers the body the
    // footer describes, and a footer that hashed itself could never state its
    // own digest — the writer would have to know the answer before writing the
    // question.
    this.hash.update(line + NEWLINE);

    if (Array.isArray(value)) {
      if (!this.table) throw new Error(`line ${this.lineNo}: a row before any table header`);
      if (value.length !== this.table.columns.length) {
        throw new Error(
          `line ${this.lineNo}: ${this.table.name} row has ${value.length} value(s), ` +
          `header declares ${this.table.columns.length}`
        );
      }
      this.counts[this.table.name]++;
      return this.on.onRow?.(value);
    }

    if (typeof value.table !== 'string' || !Array.isArray(value.columns)) {
      throw new Error(`line ${this.lineNo}: expected a table header, a row, or the footer`);
    }
    this.table = { name: value.table, columns: value.columns };
    if (this.counts[value.table] === undefined) this.counts[value.table] = 0;
    // Returned rather than fired and forgotten: the restore's table handler is
    // async — it reads the target's columns before the first row of that block
    // arrives — and a push() that did not hand back its promise would let rows
    // start landing before anything knew where to put them.
    return this.on.onTable?.(value.table, value.columns);
  }

  /**
   * The three checks that separate a backup from a file that looks like one.
   * All three are cheap and all three have to pass before a single row of a
   * restore is trusted.
   */
  finish() {
    if (this.manifest === null) throw new Error('the dump is empty');
    if (!this.footer) {
      throw new Error(
        'the dump has no footer — it was truncated, and restoring it would ' +
        'silently load only the part that survived'
      );
    }

    const digest = this.hash.digest('hex');
    if (this.footer.sha256 !== digest) {
      throw new Error(
        `the dump does not match its own checksum (footer ${String(this.footer.sha256).slice(0, 12)}…, ` +
        `read ${digest.slice(0, 12)}…) — it has been truncated, edited or corrupted`
      );
    }

    for (const [table, want] of Object.entries(this.footer.counts || {})) {
      const got = this.counts[table] ?? 0;
      if (got !== want) {
        throw new Error(`${table}: footer says ${want} row(s), the file holds ${got}`);
      }
    }
    return { manifest: this.manifest, counts: this.counts };
  }
}

/**
 * Parses a whole dump held in a string. Convenience for the tests and for
 * anything small; the restore streams instead, see DumpReader.
 */
export function parseDumpText(text) {
  const blocks = [];
  const reader = new DumpReader({
    onTable: (table, columns) => blocks.push({ table, columns, rows: [] }),
    onRow: values => blocks[blocks.length - 1].rows.push(values),
  });
  for (const line of String(text).split(NEWLINE)) reader.push(line);
  const { manifest } = reader.finish();
  return { manifest, blocks };
}

/**
 * Compares the columns a dump carries against the columns the target actually
 * has, and says which of the differences are fatal.
 *
 * This is the check for the scenario the whole runbook is written around: a
 * migration went wrong, and the database being restored INTO is running a
 * schema that has moved since the dump was taken. The two directions are not
 * symmetrical and treating them the same is the mistake.
 *
 * A column in the dump that the target no longer has is data with nowhere to
 * go. Loading around it means quietly discarding a column of the backup, so it
 * is fatal by default — the operator has to say, in as many words, that the
 * column is meant to be dropped.
 *
 * A column the target has that the dump does not is the ordinary case: the
 * column was added after the dump was taken. It takes its schema default, and a
 * NOT NULL column with no default is the only version of that which cannot
 * work, so only that one is fatal.
 */
export function checkColumns({ table, dumpColumns, targetColumns }) {
  const target = new Map(targetColumns.map(c => [c.name, c]));
  const inDump = new Set(dumpColumns);

  const missingInTarget = dumpColumns.filter(c => !target.has(c));
  const addedInTarget = targetColumns.filter(c => !inDump.has(c.name));
  const unfillable = addedInTarget.filter(c => c.notNull && !c.hasDefault && !c.isIdentity);

  const errors = [];
  if (missingInTarget.length) {
    errors.push(
      `${table}: the dump carries column(s) this database does not have — ` +
      `${missingInTarget.join(', ')}. Restoring would discard them. Bring the schema ` +
      `up to date (npm run db:setup), or pass --drop-unknown-columns to load without them.`
    );
  }
  for (const c of unfillable) {
    errors.push(
      `${table}: this database has a NOT NULL column with no default that the dump ` +
      `does not carry — ${c.name}. Every row would be rejected.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    missingInTarget,
    addedInTarget: addedInTarget.map(c => c.name),
    load: dumpColumns.filter(c => target.has(c)),
  };
}
