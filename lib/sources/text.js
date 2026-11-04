// Small text helpers shared by the sources. plain() is from Outreach's
// lib/discovery/enrich/match.js; quote() is new.

/** Plain text from a bit of HTML or an RSS field. */
function plain(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The first `max` characters of `text` on a word boundary, quoted — what a signal shows. */
function quote(text, max = 220) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return `“${t}”`;
  const cut = t.slice(0, max);
  return `“${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).trim()}…”`;
}

/** "acme-labs.co.in" → "Acme Labs": a readable name from a company's domain. */
function nameFromDomain(domain) {
  const host = String(domain || '').toLowerCase().replace(/^www\./, '');
  const base = host.split('.')[0] || '';
  return base.split(/[-_]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

module.exports = { plain, quote, nameFromDomain };
