import { currentAdmin } from '../../../../../lib/auth.js';
import { can } from '../../../../../lib/admin-roles.js';
import { sql } from '../../../../../lib/db.js';

export const dynamic = 'force-dynamic';

const HEADERS = ['Email', 'Name', 'Phone', 'Language', 'Hair type', 'Source', 'Status', 'Joined', 'Confirmed'];
const PAGE = 500;

function iso(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * One CSV cell. Everything is quoted, and a leading =, +, - or @ gets an
 * apostrophe in front: without it Excel treats a subscriber-supplied name as a
 * formula and runs it when the file is opened.
 */
function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const line = values => `${values.map(cell).join(',')}\r\n`;

export async function GET() {
  // Route handlers do not run layouts, so the session check lives here too.
  const admin = await currentAdmin();
  if (!admin) return new Response(null, { status: 302, headers: { Location: '/admin/login' } });

  /*
   * And the permission, because this is the one URL in the panel that hands
   * over the entire customer list as a file.
   *
   * A route handler has no form and no button, so the tab strip hiding the link
   * on the subscribers screen protects nothing at all here - anybody with a
   * session can type this address. Staff can read the list a row at a time,
   * which is what answering a phone call needs; they cannot take a copy of it,
   * which is what nothing needs.
   */
  if (!can(admin.role, 'subscribers:export')) {
    return new Response(null, { status: 302, headers: { Location: '/admin?m=forbidden' } });
  }

  const enc = new TextEncoder();
  let offset = 0;
  let finished = false;

  // Streamed in pages so a list of any size never has to sit in memory at once.
  const body = new ReadableStream({
    start(controller) {
      // BOM first, or Excel reads the Arabic names as mojibake.
      controller.enqueue(enc.encode(`\uFEFF${line(HEADERS)}`));
    },
    async pull(controller) {
      if (finished) { controller.close(); return; }

      const rows = await sql`
        SELECT email, name, phone, lang, hair_type, source, status, created_at, confirmed_at
          FROM subscribers
         ORDER BY id DESC
         LIMIT ${PAGE} OFFSET ${offset}`;

      offset += rows.length;
      if (rows.length < PAGE) finished = true;

      let chunk = '';
      for (const r of rows) {
        chunk += line([
          r.email, r.name, r.phone, r.lang, r.hair_type,
          r.source, r.status, iso(r.created_at), iso(r.confirmed_at),
        ]);
      }
      if (chunk) controller.enqueue(enc.encode(chunk));
      if (finished) controller.close();
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="starseven-subscribers-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
