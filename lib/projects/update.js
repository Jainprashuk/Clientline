/**
 * A progress update to the client, written from the project's own record and
 * nothing else: what's been ticked off since the last update, what's next, and
 * where it stands against the target date. No AI — an update must never claim
 * work that isn't done. You edit it before it goes.
 */
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });

/** Pure: the update's body (no greeting / sign-off). */
function updateText({ deal, health, payments }) {
  const p = deal.project || {};
  const since = p.updates && p.updates.length ? new Date(p.updates[p.updates.length - 1].at) : null;
  const done = (p.tasks || []).filter(t => t.done && (!since || !t.doneAt || new Date(t.doneAt) > since)).map(t => t.text);
  const left = (p.tasks || []).filter(t => !t.done).map(t => t.text);
  if (!done.length && !left.length) return null;
  const lines = [`A quick update on ${deal.name}.`];
  if (done.length) lines.push(`Done${since ? ` since my last update` : ' so far'}:\n${done.map(t => `• ${t}`).join('\n')}`);
  if (left.length) lines.push(`Next:\n${left.slice(0, 6).map(t => `• ${t}`).join('\n')}${left.length > 6 ? `\n• …and ${left.length - 6} more` : ''}`);
  else lines.push('Everything on the list is done — I’ll send it over for you to check.');
  if (p.targetAt && left.length) {
    lines.push(health.state === 'late' ? `This is taking longer than planned (the target was ${day(p.targetAt)}). [When you now expect to finish]`
      : health.state === 'behind' ? `I’m a little behind, still aiming for ${day(p.targetAt)}.`
      : `On course for ${day(p.targetAt)}.`);
  }
  const next = payments.find(x => x.part === 1 && !x.invoice);
  if (next && /demo/.test(next.label) && left.length) lines.push('I’ll share a demo for you to try at the halfway point.');
  lines.push('Any questions, just reply here.');
  return lines.join('\n\n');
}

module.exports = { updateText };
