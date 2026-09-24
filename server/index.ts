import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { api } from './routes';
import { aiEnabled, MODEL } from './ai/client';

// Load ANTHROPIC_API_KEY etc. from a local .env when present (Node ≥ 20.12).
try { process.loadEnvFile(); } catch { /* no .env file */ }

const here = path.dirname(fileURLToPath(import.meta.url));
// In dev the API sits behind Vite's proxy on its own port; PORT belongs to the web server.
const devMode = process.argv.includes('--dev');
const port = devMode ? Number(process.env.API_PORT) || 8787 : Number(process.env.PORT) || 8787;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', api);

  // In production, serve the built React app.
  const dist = path.resolve(here, '../dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number }).status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : (err as Error).message });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(port, () => {
    console.log(`FinanceOman API listening on http://localhost:${port} (AI: ${aiEnabled() ? MODEL : 'offline mode'})`);
  });
}
