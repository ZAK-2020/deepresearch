import { parentPort, workerData } from 'node:worker_threads';
import { PDFParse } from 'pdf-parse';
const parser = new PDFParse({ data: workerData });
try {
  const info = await parser.getInfo();
  if (info.total > 100) throw new Error('PDFs are limited to 100 pages.');
  const pages = [];
  let characters = 0;
  for (let page = 1; page <= info.total; page++) {
    const result = await parser.getText({ partial: [page] });
    const text = result.pages.map(p => p.text).join('\n');
    characters += text.length;
    if (characters > 200000) throw new Error('Documents are limited to 200,000 extracted characters.');
    pages.push({ page, text });
  }
  parentPort.postMessage({ pages });
} catch (error) {
  const message = ['PDFs are limited to 100 pages.', 'Documents are limited to 200,000 extracted characters.'].includes(error.message)
    ? error.message : 'Could not read this PDF. Use an unencrypted PDF with selectable text.';
  parentPort.postMessage({ error: message });
} finally { await parser.destroy(); }
