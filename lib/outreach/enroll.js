/**
 * Putting leads into a sequence, and taking them out.
 *
 * A lead can go in only when you approved it and it would actually get a good first
 * email: it is approved, has an email we're sure of (high or medium — a guessed one is manual
 * only, per the leads plan), isn't blocked, isn't already in a sequence, and the
 * sequence's first email renders for it without a gap. Each refusal says why.
 */
const Lead = require('../../models/Lead');
const Sequence = require('../../models/Sequence');
const Enrollment = require('../../models/Enrollment');
const Profile = require('../../models/Profile');
const Settings = require('../../models/Settings');
const { loadBlocklistSets, isBlocked } = require('../blocklist');
const { renderStep, whyBlocked } = require('./render');

async function enroll(userId, leadIds, sequenceId, now = new Date()) {
  const seq = await Sequence.findOne({ _id: sequenceId, userId }).lean();
  if (!seq) return { error: 'No such sequence' };
  const [leads, profile, settings, blocked] = await Promise.all([
    Lead.find({ _id: { $in: leadIds }, userId }).lean(),
    Profile.findOne({ userId }).lean(),
    Settings.findOne({ userId }, { senderName: 1, bookingUrl: 1 }).lean(),
    loadBlocklistSets(userId),
  ]);
  const added = []; const skipped = [];
  const skip = (l, reason) => skipped.push({ id: String(l._id), name: l.name, reason });

  for (const l of leads) {
    if (l.status !== 'approved') {
      skip(l, l.status === 'new' ? 'Approve it first' : l.status === 'in-sequence' ? 'Already in a sequence' : l.status === 'held' ? 'It is waiting for an email' : `It is ${l.status}`);
      continue;
    }
    if (!l.email) { skip(l, 'No email'); continue; }
    if (!['high', 'medium'].includes(l.emailConfidence)) { skip(l, 'The email is a guess — write to them yourself first'); continue; }
    if (isBlocked(l.email, blocked)) { skip(l, 'This address is on your blocklist'); continue; }
    const first = renderStep(seq.steps[0], l, profile || {}, settings || {});
    if (!first.ok) { skip(l, whyBlocked(first)); continue; }
    try {
      await Enrollment.create({
        userId, leadId: l._id, sequenceId: seq._id, email: l.email, step: 0,
        nextAt: now, enrolledAt: now, threadSubject: first.subject,
      });
      await Lead.updateOne({ _id: l._id, userId }, { $set: { status: 'in-sequence', sequenceId: seq._id, decidedAt: l.decidedAt || now } });
      added.push(String(l._id));
    } catch (err) {
      if (err.code === 11000) { skip(l, 'Already in a sequence'); continue; }
      throw err;
    }
  }
  return { added, skipped, sequence: { id: String(seq._id), name: seq.name, active: seq.active } };
}

/**
 * Stops a lead's sequence. 'manual' puts the lead back in Approved; other reasons
 * (replied, bounced, unsubscribed) are set by whoever noticed them.
 */
async function stop(userId, leadIds, reason = 'manual') {
  const r = await Enrollment.updateMany(
    { userId, leadId: { $in: leadIds }, status: { $in: ['active', 'paused'] } },
    { $set: { status: 'stopped', stopReason: reason, sendingUntil: null } },
  );
  if (reason === 'manual') {
    await Lead.updateMany({ userId, _id: { $in: leadIds }, status: 'in-sequence' }, { $set: { status: 'approved', sequenceId: null } });
  }
  return r.modifiedCount;
}

/** The current (or last) enrolment of one lead, with its sequence, for the drawer. */
async function forLead(userId, leadId) {
  const e = await Enrollment.findOne({ userId, leadId }).sort({ enrolledAt: -1 }).lean();
  if (!e) return null;
  const seq = await Sequence.findOne({ _id: e.sequenceId, userId }, { name: 1, steps: 1, active: 1 }).lean();
  return {
    status: e.status, stopReason: e.stopReason, step: e.step, nextAt: e.nextAt, enrolledAt: e.enrolledAt,
    sequence: seq ? { id: String(seq._id), name: seq.name, steps: seq.steps.length, active: seq.active } : null,
    lastError: e.lastError,
  };
}

module.exports = { enroll, stop, forLead };
