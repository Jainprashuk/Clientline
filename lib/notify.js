/**
 * Admin notifications.
 *
 * lib/loginCode.js (shared with Outreach) calls notifyAdmins when somebody asks
 * for access. Clientline has no notification bell: access requests are worked
 * from the separate admin app, which reads the shared accessrequests collection
 * directly. So this only records the event in the server log.
 *
 * Never throws, like Outreach's — a person asking for access must not fail
 * because of the admins' side of it.
 */
async function notifyAdmins(payload) {
  try {
    console.log(`[notify] ${payload.type}: ${payload.title}`);
  } catch (_) { /* logging only */ }
}

module.exports = { notifyAdmins };
