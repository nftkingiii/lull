import express from 'express';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { now } from './routes/now.js';
import { weekends } from './routes/weekends.js';
import { positions } from './routes/positions.js';
import { stocks } from './routes/stocks.js';
import { startIndexer } from './indexer.js';

const app = express();
const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req)).then((b) => res.json(b)).catch((e) => {
  // Upstream failures are surfaced as errors, never replaced with demo data.
  res.status(e.status ?? 502).json({ error: e.shortMessage ?? e.message });
});

app.get('/api/now', wrap(() => now()));
app.get('/api/stocks', wrap(() => stocks()));
app.get('/api/positions/:wallet', wrap((req) => positions(req.params.wallet)));
app.get('/api/weekends', wrap((req) => weekends({ symbol: req.query.symbol })));
app.get('/api/health', (req, res) => res.json({ ok: true, commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null }));
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// In production one service serves both: the built web app, with the SPA's index.html as fallback.
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`lull api on :${port}`));
if (process.env.LULL_NO_INDEXER !== '1') startIndexer();
