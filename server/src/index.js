import express from 'express';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { now } from './routes/now.js';
import { weekends } from './routes/weekends.js';
import { positions } from './routes/positions.js';
import { stocks } from './routes/stocks.js';
import { startIndexer, refreshNow } from './indexer.js';
import { TEST_CLOCK, setTestNow, testNow } from './clock.js';

const app = express();
app.disable('x-powered-by');

// Hardening headers. The app loads only its own scripts, Google Fonts and Robinhood's token logos.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://cdn.robinhood.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
});
const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req)).then((b) => res.json(b)).catch((e) => {
  // Upstream failures are surfaced as errors, never replaced with demo data.
  res.status(e.status ?? 502).json({ error: e.shortMessage ?? e.message });
});

app.get('/api/now', wrap(() => now()));
app.get('/api/stocks', wrap(() => stocks()));
app.get('/api/positions/:wallet', wrap((req) => positions(req.params.wallet)));
app.get('/api/weekends', wrap((req) => weekends({ symbol: req.query.symbol })));
app.get('/api/health', (req, res) => res.json({ ok: true, commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null, testClock: testNow() }));
// Rehearsal hook: move the pinned clock and rebuild. Exists only with LULL_TEST_CLOCK=1 outside production.
if (TEST_CLOCK) {
  app.post('/api/_test/clock', wrap(async (req) => {
    setTestNow(String(req.query.at ?? ''));
    await refreshNow();
    return { testClock: testNow() };
  }));
}
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
