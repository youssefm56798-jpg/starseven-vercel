import { csrfToken } from '../../../../lib/auth.js';
import { listAdmins } from '../../../../lib/admin-accounts.js';
import { PERMISSIONS } from '../../../../lib/admin-roles.js';
import ConfirmButton from '../../_lib/confirm-button.js';
import { requireOwner } from '../../_lib/guard.js';
import { dt, Flash } from '../../_lib/ui.js';
import {
  changeAdminRole, createStaffAccount, deleteAdmin, mailResetLink, suspendAdmin,
} from '../../_lib/account-actions.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accounts — Star Seven admin' };

/**
 * Who can sign in to this panel.
 *
 * The screen is owner-only, and requireOwner() is what makes that true — the
 * tab is also hidden from staff, but hiding is a courtesy and the check is the
 * control. Every form on this page posts to an action that repeats the check,
 * and lib/admin-accounts.js repeats it a third time from the database.
 *
 * The rule the whole screen is arranged around is that the last owner cannot be
 * demoted, suspended or removed. It is enforced in SQL, so it holds even for a
 * request that never rendered this page — but the buttons are also simply not
 * drawn for that row, because a control that always fails is worse than no
 * control.
 */
const ROLE_BLURB = {
  owner: 'Everything, including this screen.',
  staff: 'Orders end to end. Can read products and subscribers, and cannot change prices, send offers, export the list or touch accounts.',
};

function RoleCell({ admin, csrf, lastOwner }) {
  if (lastOwner) {
    return (
      <span className="muted" title="The last owner cannot be demoted — that is the lockout this screen exists to prevent.">
        Owner (only)
      </span>
    );
  }
  const next = admin.role === 'owner' ? 'staff' : 'owner';
  return (
    <form action={changeAdminRole}>
      <input type="hidden" name="_csrf" value={csrf} />
      <input type="hidden" name="id" value={admin.id} />
      <input type="hidden" name="role" value={next} />
      <span className={`pill ${admin.role === 'owner' ? 'delivered' : 'new'}`}>{admin.role}</span>
      {' '}
      <ConfirmButton
        message={next === 'owner'
          ? 'Make this account an owner? It will be able to create, suspend and remove admin accounts, including yours.'
          : 'Make this account staff? It loses accounts, offers, product edits and the subscriber export.'}
      >
        Make {next}
      </ConfirmButton>
    </form>
  );
}

export default async function AccountsPage({ searchParams }) {
  const me = await requireOwner();
  const sp = await searchParams;
  const token = await csrfToken();

  const admins = await listAdmins();
  const activeOwners = admins.filter(a => a.role === 'owner' && !a.suspended);
  const names = new Map(admins.map(a => [a.id, a.name || a.email]));

  return (
    <>
      <h1>Accounts</h1>
      <p className="sub">
        Who can sign in to this panel. Every status change an admin makes is recorded
        against their account id, so one login per person is what makes that record
        worth keeping.
      </p>

      <Flash code={sp?.m} />

      <div className="cards">
        <div className="kpi"><b>{admins.length}</b><span>Accounts</span></div>
        <div className="kpi"><b>{activeOwners.length}</b><span>Owners</span></div>
        <div className="kpi"><b>{admins.filter(a => a.suspended).length}</b><span>Suspended</span></div>
        <div className="kpi"><b>{admins.filter(a => a.twoFactor).length}</b><span>With two-factor</span></div>
      </div>

      {/* --------------------------------------------------------- the list */}

      <div className="panel">
        <h2>People</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Person</th><th>Role</th><th>Two-factor</th>
                <th>Last login</th><th>Added</th><th></th>
              </tr>
            </thead>
            <tbody>
              {admins.map(a => {
                const lastOwner = a.role === 'owner' && activeOwners.length <= 1;
                const self = a.id === me.id;
                return (
                  <tr key={a.id} style={a.suspended ? { opacity: 0.55 } : undefined}>
                    <td>
                      <b>{a.name || '—'}</b>{self ? <span className="muted"> (you)</span> : null}
                      <div className="muted">{a.email}</div>
                      <div className="muted">
                        #{a.id}
                        {a.suspended ? <> · <span className="pill cancelled">suspended {dt(a.suspendedAt)}</span></> : null}
                      </div>
                    </td>
                    <td>{self
                      ? <span className={`pill ${a.role === 'owner' ? 'delivered' : 'new'}`}>{a.role}</span>
                      : <RoleCell admin={a} csrf={token} lastOwner={lastOwner} />}
                    </td>
                    <td>
                      {a.twoFactor
                        ? <><span className="pill delivered">on</span> <span className="muted">{a.recoveryLeft} codes</span></>
                        : <span className="pill new">off</span>}
                    </td>
                    <td>{a.lastLogin ? dt(a.lastLogin) : <span className="muted">never</span>}</td>
                    <td>
                      {dt(a.createdAt)}
                      {a.createdBy ? <div className="muted">by {names.get(a.createdBy) || `#${a.createdBy}`}</div> : null}
                    </td>
                    <td>
                      <div className="bar-row">
                        <form action={mailResetLink}>
                          <input type="hidden" name="_csrf" value={token} />
                          <input type="hidden" name="email" value={a.email} />
                          <button className="btn sm ghost" type="submit" disabled={a.suspended}>
                            Email a reset link
                          </button>
                        </form>

                        {self || lastOwner ? null : (
                          <>
                            <form action={suspendAdmin}>
                              <input type="hidden" name="_csrf" value={token} />
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="act" value={a.suspended ? 'restore' : 'suspend'} />
                              <ConfirmButton
                                message={a.suspended
                                  ? 'Let this account sign in again?'
                                  : 'Suspend this account? Every browser it is signed in to is signed out immediately, and it cannot log back in.'}
                              >
                                {a.suspended ? 'Restore' : 'Suspend'}
                              </ConfirmButton>
                            </form>

                            <form action={deleteAdmin}>
                              <input type="hidden" name="_csrf" value={token} />
                              <input type="hidden" name="id" value={a.id} />
                              <ConfirmButton
                                className="btn sm red"
                                message="Delete this account for good? Suspending is usually what you want — it stops the login while keeping the name on everything this person has already done."
                              >
                                Delete
                              </ConfirmButton>
                            </form>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------------------------------- add a person */}

      <div className="panel">
        <h2>Add someone</h2>
        <div className="pad">
          <p className="sub">
            Set a password here and hand it over in person — then have them change it on
            the Security tab. There is no emailed invitation on purpose: an invite that
            bounces leaves somebody standing next to you unable to log in, and the
            <b> Email a reset link </b> button above covers the case where they are not
            in the room.
          </p>

          <form action={createStaffAccount}>
            <input type="hidden" name="_csrf" value={token} />
            <div className="field">
              <label htmlFor="acct-name">Name</label>
              <input id="acct-name" name="name" required style={{ maxWidth: '320px' }} />
            </div>
            <div className="field">
              <label htmlFor="acct-email">Email</label>
              <input id="acct-email" name="email" type="email" required
                     autoComplete="off" style={{ maxWidth: '320px' }} />
            </div>
            <div className="field">
              <label htmlFor="acct-role">Role</label>
              <select id="acct-role" name="role" defaultValue="staff" style={{ maxWidth: '320px' }}>
                <option value="staff">Staff</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="acct-pass">Password (10+ characters)</label>
              <input id="acct-pass" name="pass" type="password" required minLength={10}
                     autoComplete="new-password" style={{ maxWidth: '320px' }} />
            </div>
            <div className="field">
              <label htmlFor="acct-confirm">Password again</label>
              <input id="acct-confirm" name="confirm" type="password" required minLength={10}
                     autoComplete="new-password" style={{ maxWidth: '320px' }} />
            </div>
            <button className="btn red" type="submit">Create account</button>
          </form>
        </div>
      </div>

      {/* ------------------------------------------------------ what each role is */}

      <div className="panel">
        <h2>What each role can do</h2>
        <div className="pad">
          {Object.keys(PERMISSIONS).map(role => (
            <div className="kv" key={role}>
              <b>{role}</b>
              <span className="muted">{ROLE_BLURB[role]}</span>
            </div>
          ))}
          <p className="muted" style={{ marginTop: '10px' }}>
            Staff keep every power that leaves a trail — a status move, a note and a call
            outcome all write a row stamped with their account id. What they do not have
            is the handful that would not: prices, offers, the subscriber export, and this
            screen.
          </p>
        </div>
      </div>
    </>
  );
}
