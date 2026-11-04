/**
 * Fit score: intent + fit + timing + reachability, every point with a reason a
 * person can read ("+15: posted 2 days ago"). Missing information is neutral —
 * a post that names no budget loses nothing for it.
 *
 * Pure. Runs only on items the gates kept or held (lib/leads/gates.js).
 * Thresholds: 75+ strong, under 50 weak (hidden by default on the Leads page).
 */
const DAY = 24 * 3600 * 1000;
const STRONG = 75;
const WEAK = 50;

const CONFIDENCE_POINTS = { high: 20, medium: 12, low: 5 };

// Client types as the text tends to say them.
const TYPE_HINTS = {
  startups: /\b(?:start[\s-]?ups?|founder|co[\s-]?founder|seed|pre[\s-]?seed|series\s+[ab]|mvp|yc|y\s+combinator)\b/i,
  saas: /\bsaas\b|\bb2b\s+software\b|\bsubscription\s+(?:app|software|platform)\b/i,
  ecommerce: /\b(?:e[\s-]?commerce|d2c|dtc|shopify|online\s+store|woocommerce)\b/i,
  'local-business': /\b(?:restaurant|cafe|café|clinic|salon|gym|shop|store\s+owner|hotel|bakery|boutique)\b/i,
  agencies: /\b(?:agency|studio)\b/i,
  nonprofit: /\b(?:non[\s-]?profit|ngo|charity|foundation)\b/i,
  enterprise: /\b(?:enterprise|fortune\s+500|large\s+company)\b/i,
};

/**
 * @param item    the normalised item (see gates.js), with item.emailConfidence set
 * @param verdict what judge() returned for it
 * @param profile the user's profile
 * @returns {{ fit: number, fitWhy: string[] }}
 */
function score(item, verdict, profile = {}, now = new Date()) {
  const why = [];
  let fit = 0;
  const add = (points, reason) => { fit += points; why.push(`+${points}: ${reason}`); };

  // Intent: they asked, or something just happened to them.
  if (item.sourceType === 'trigger') add(18, item.triggerReason || 'something just changed for them');
  else add(item.ai && item.ai.needsFreelancer === true ? 30 : 25, 'they asked for help');

  // Fit: the service, the kind of client, the budget, the place.
  const hits = verdict.serviceHits || [];
  if (hits.length) add(Math.min(30, 18 + 4 * (hits.length - 1)), `matches your ${verdict.service.name} service (${hits.slice(0, 3).join(', ')})`);
  const type = (profile.clientTypes || []).find(t => TYPE_HINTS[t] && TYPE_HINTS[t].test(item.text || ''));
  if (type) add(6, `the kind of client you want (${type.replace('-', ' ')})`);
  if (verdict.budget && !verdict.budget.hourly) add(8, `states a budget (${verdict.budget.currency} ${Math.round(verdict.budget.amount).toLocaleString('en-IN')})`);
  if (verdict.place === 'wanted') add(6, 'in a place you work with');
  else if (verdict.place === 'global' || verdict.place === 'remote') add(3, 'remote');

  // Timing.
  const posted = item.postedAt ? new Date(item.postedAt) : null;
  if (posted && !Number.isNaN(posted.getTime())) {
    const days = Math.max(0, (now - posted) / DAY);
    const label = days < 1 ? 'today' : `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} ago`;
    if (days <= 2) add(15, `posted ${label}`);
    else if (days <= 7) add(10, `posted ${label}`);
    else if (days <= 30) add(4, `posted ${label}`);
  }

  // Reachability.
  const points = CONFIDENCE_POINTS[item.emailConfidence];
  if (points) add(points, item.emailConfidence === 'high' ? 'their email is on the post or their site' : item.emailConfidence === 'medium' ? 'a company email that accepts mail' : 'a guessed email');

  return { fit: Math.min(100, fit), fitWhy: why };
}

/** The bonus when independent sources point at the same company. */
const STACK_BONUS = 10;

module.exports = { score, STRONG, WEAK, STACK_BONUS, TYPE_HINTS };
