// The text of a resume PDF, read in the browser: the file itself is never uploaded.
// pdf.js is loaded only when someone picks a file, so it isn't in the main bundle.

/** Every page's text, lines kept roughly as laid out. Throws a readable error. */
export async function pdfText(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('That file is over 10 MB — is it the right one?');
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = ''; const lines: string[] = [];
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      line += item.str || '';
      if (item.hasEOL) { lines.push(line); line = ''; } else if (item.str) line += ' ';
    }
    if (line) lines.push(line);
    pages.push(lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
  }
  const text = pages.join('\n\n').trim();
  if (text.length < 200) throw new Error('No text could be read from this PDF — it may be a scanned image. Paste the text instead.');
  return text;
}
