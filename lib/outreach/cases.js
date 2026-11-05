/**
 * Which of the user's past work best proves they can do what this lead needs.
 * Deterministic, so the same lead always gets the same proof, and the follow-up
 * can show the next one. Pure.
 */
const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9.+#-]{4,}/g) || [];

/** Cases worth citing for this lead, best first (score > 0 only). */
function rankCases(profile, lead) {
  const service = (profile.services || []).find(s => s.name === lead.service);
  const keywords = (service && service.keywords) || [];
  const theirs = new Set(words(`${lead.about || ''} ${(lead.signals || []).map(s => s.text).join(' ')}`));
  return (profile.cases || [])
    .map((c, i) => {
      const text = `${c.title} ${c.result} ${c.client || ''}`.toLowerCase();
      let score = c.service && lead.service && c.service === lead.service ? 100 : 0;
      for (const k of keywords) if (k && text.includes(k)) score += 10;
      for (const w of new Set(words(text))) if (theirs.has(w)) score += 2;
      return { c, i, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(x => x.c);
}

/** For the day-3 follow-up: another piece of work than the one email 1 used, or the portfolio. */
function caseLine(profile, lead) {
  const used = lead.firstEmail && lead.firstEmail.caseTitle;
  const next = rankCases(profile, lead).find(c => c.title !== used);
  if (next) return `Another one close to this: ${next.title} — ${next.result}${next.url ? `\n${next.url}` : ''}`;
  if (profile.portfolioUrl && !(lead.firstEmail && lead.firstEmail.link === profile.portfolioUrl)) return `More of my work is here: ${profile.portfolioUrl}`;
  return '';
}

module.exports = { rankCases, caseLine };
