/**
 * Red flags in what a client said, by rule, never AI — each with the words that
 * set it off, so you can judge it yourself. Pure.
 */
const RULES = [
  { rule: 'unpaid-test', label: 'Wants unpaid work first',
    rx: /\b(?:unpaid|free)\s+(?:(?:test|trial|sample)(?:\s+(?:task|project))?|task)\b|\btest\s+task\b[^.]{0,40}\b(?:unpaid|for free|free of cost)\b|\bdo\s+(?:a\s+)?(?:small\s+)?(?:sample|test)\b[^.]{0,30}\b(?:free|first)\b/i },
  { rule: 'pay-later', label: 'Pay later, or not in money',
    rx: /\bpay(?:ment)?\s+(?:only\s+)?(?:after|once|when)\s+(?:the\s+)?(?:launch|we\s+launch|it\s+works|we\s+get\s+funding|funding|we\s+make\s+money)|\bequity[\s-]only\b|\brevenue[\s-]share\s+only\b|\bno\s+upfront\b|\bfor\s+(?:the\s+)?exposure\b/i },
  { rule: 'urgent', label: 'In a rush', rx: /\b(?:urgent(?:ly)?|asap|by\s+tomorrow|tonight|within\s+(?:24|48)\s+hours|immediately|right\s+away)\b/i },
  { rule: 'scope-creep', label: 'Open-ended scope', rx: /\b(?:unlimited\s+(?:revisions|changes)|a\s+few\s+small\s+changes\s+later|ongoing\s+changes\s+included|and\s+more\s+as\s+needed)\b/i },
];

/**
 * @param {string} text   everything they wrote (post + replies)
 * @param {{value?: number, minimum?: number}} money  in the same units (minor)
 * @returns {{rule, label, words}[]}
 */
function flagsFor(text, { value = 0, minimum = 0 } = {}) {
  const t = String(text || '');
  const out = [];
  const low = value > 0 && minimum > 0 && value < minimum;
  for (const r of RULES) {
    const m = t.match(r.rx);
    if (!m) continue;
    // A rush alone is fine; a rush on a small budget is the flag.
    if (r.rule === 'urgent' && !(value > 0 && minimum > 0 && value < 2 * minimum)) continue;
    out.push({ rule: r.rule, label: r.rule === 'urgent' ? 'In a rush, on a small budget' : r.label, words: `“${m[0]}”` });
  }
  if (low) out.unshift({ rule: 'below-minimum', label: 'Budget is below your minimum', words: '' });
  return out;
}

module.exports = { flagsFor, RULES };
