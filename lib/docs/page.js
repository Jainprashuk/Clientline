/**
 * The shell of the public pages a client opens from a link (/p proposal, /i invoice):
 * plain server-rendered HTML, no app, no login, readable on a phone and in print.
 */
const { escapeHtml } = require('../emailLayout');

const CSS = `
:root{--bg:#f3f4f8;--card:#fff;--line:#e3e5ec;--ink:#1a1c26;--ink2:#4a4f60;--ink3:#80859a;--accent:#635bff;--accent-bg:#efeeff;--good:#127a4a;--good-bg:#e7f6ee}
@media (prefers-color-scheme:dark){:root{--bg:#0a0b0f;--card:#15161d;--line:#2a2c36;--ink:#e8e9ef;--ink2:#a2a6b5;--ink3:#7b8092;--accent:#8a84ff;--accent-bg:#221f3d;--good:#4fd394;--good-bg:#12291e}}
*{box-sizing:border-box}body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
main{max-width:860px;margin:0 auto;padding:28px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 22px;margin-bottom:14px}
h1{font-size:24px;line-height:1.25;margin:0 0 6px}h2{font-size:15px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3)}
.muted{color:var(--ink2)}.small{font-size:13px}.tiny{font-size:12px;color:var(--ink3)}
.opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.opt{border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:6px;cursor:pointer;background:var(--card)}
.opt.pick{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.opt input{position:absolute;opacity:0}.opt:has(input:checked){border-color:var(--accent);box-shadow:inset 0 0 0 2px var(--accent);background:var(--accent-bg)}
.price{font-size:24px;font-weight:700}.chip{display:inline-block;font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--accent-bg);color:var(--accent)}
ul{margin:4px 0 0;padding-left:18px}li{margin:2px 0}
label.f{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}input[type=text]{font:inherit;width:100%;max-width:360px;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink)}
button{font:inherit;font-weight:650;background:var(--accent);color:#fff;border:0;border-radius:9px;padding:11px 18px;cursor:pointer;margin-top:12px}
.ok{background:var(--good-bg);color:var(--good);border-radius:10px;padding:12px 14px;font-weight:600}
.row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left}th{font-size:12px;color:var(--ink3);font-weight:600}td.n,th.n{text-align:right}
@media print{body{background:#fff;color:#000}.card{border:0;padding:0}.noprint{display:none}}
`;

function page(title, body, { noindex = true } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

const notFound = () => page('Link not found', `<div class="card"><h1>This link isn’t valid</h1><p class="muted">It may have been copied incompletely, or replaced by a newer one. Ask for the link again.</p></div>`);

module.exports = { page, notFound, escapeHtml };
