import express from 'express';
import { now } from './routes/now.js';

const app = express();
const wrap = (fn) => (req, res) => fn(req).then((b) => res.json(b)).catch((e) => {
  // Upstream failures are surfaced as errors, never replaced with demo data.
  res.status(502).json({ error: e.shortMessage ?? e.message });
});

app.get('/api/now', wrap(() => now()));

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`lull api on :${port}`));
