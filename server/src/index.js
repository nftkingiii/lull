import express from 'express';
import { now } from './routes/now.js';
import { weekends } from './routes/weekends.js';
import { positions } from './routes/positions.js';
import { startIndexer } from './indexer.js';

const app = express();
const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req)).then((b) => res.json(b)).catch((e) => {
  // Upstream failures are surfaced as errors, never replaced with demo data.
  res.status(e.status ?? 502).json({ error: e.shortMessage ?? e.message });
});

app.get('/api/now', wrap(() => now()));
app.get('/api/positions/:wallet', wrap((req) => positions(req.params.wallet)));
app.get('/api/weekends', wrap((req) => weekends({ symbol: req.query.symbol })));

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`lull api on :${port}`));
if (process.env.LULL_NO_INDEXER !== '1') startIndexer();
