import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createApi, type HttpMethod } from './src/api';

const PORT = Number(process.env.PORT ?? 4173);
const WEB_DIR = resolve(import.meta.dirname, 'web');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const api = createApi();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    const body = await readJsonBody(req);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[name] = value;
    }
    const response = api.handle({
      method: (req.method ?? 'GET') as HttpMethod,
      path: url.pathname.slice('/api'.length),
      body,
      headers,
    });
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response.body));
    return;
  }

  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const filePath = resolve(WEB_DIR, file);
  if (!filePath.startsWith(WEB_DIR + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return null; // the API answers 400 INVALID_BODY
  }
}

server.listen(PORT, () => {
  console.log(`giving-platform dev server → http://localhost:${PORT}`);
});
