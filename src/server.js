const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const Link = require('./models/Link');
const { basicAuth } = require('./auth');

const { PORT = 3000, MONGO_URI, ADMIN_USER, ADMIN_PASSWORD, BASE_URL } = process.env;

// Falla al arrancar en vez de desplegar un panel sin protección.
if (!MONGO_URI || !ADMIN_USER || !ADMIN_PASSWORD) {
  console.error('Faltan variables: MONGO_URI, ADMIN_USER, ADMIN_PASSWORD');
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_PASSWORD debe tener al menos 12 caracteres');
  process.exit(1);
}

const app = express();
// Coolify pone Traefik delante: necesario para req.ip (rate limit) y req.protocol reales.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

const RESERVED = new Set(['admin', 'api', 'healthz', 'favicon.ico', 'robots.txt']);
const SLUG_RE = /^[a-zA-Z0-9_-]{3,40}$/;

const redirectLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
// Solo cuenta intentos fallidos: frena fuerza bruta sin molestar al uso normal.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});
const auth = basicAuth(ADMIN_USER, ADMIN_PASSWORD);

const baseUrl = (req) => (BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const serialize = (req, l) => ({
  id: l._id,
  slug: l.slug,
  type: l.type,
  target: l.target,
  label: l.label,
  clicks: l.clicks,
  active: l.active,
  createdAt: l.createdAt,
  shortUrl: `${baseUrl(req)}/${l.slug}`,
});

class ValidationError extends Error {}

function resolveTarget({ type, url, phone, message }) {
  if (type === 'url') {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new ValidationError('URL inválida');
    }
    // Solo http/https: evita javascript: y otros esquemas.
    if (!['http:', 'https:'].includes(u.protocol)) throw new ValidationError('Solo se permiten URLs http/https');
    return u.toString();
  }
  if (type === 'whatsapp') {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) throw new ValidationError('Teléfono inválido (incluye código de país)');
    const text = String(message || '').slice(0, 1000);
    return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  }
  throw new ValidationError('type debe ser "url" o "whatsapp"');
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));
// La raíz no tiene contenido propio: manda al panel (que pide credenciales).
app.get('/', (_req, res) => res.redirect(302, '/admin/'));

// --- Panel y API (protegidos) ---
app.use('/admin', authLimiter, auth, express.static(path.join(__dirname, '..', 'public')));

const api = express.Router();
api.use(authLimiter, auth);

api.get('/links', async (req, res, next) => {
  try {
    const links = await Link.find().sort({ createdAt: -1 }).limit(500);
    res.json(links.map((l) => serialize(req, l)));
  } catch (e) {
    next(e);
  }
});

api.post('/links', async (req, res, next) => {
  try {
    const body = req.body || {};
    const target = resolveTarget(body);
    const { slug } = body;
    if (slug && (!SLUG_RE.test(slug) || RESERVED.has(slug.toLowerCase()))) {
      throw new ValidationError('Slug inválido o reservado (3-40, letras, números, - _)');
    }
    const doc = { type: body.type, target, label: String(body.label || '').slice(0, 100) };

    // Slug aleatorio: reintenta ante colisión (muy improbable con 6 chars base64url).
    for (let i = 0; i < 5; i++) {
      try {
        const link = await Link.create({ ...doc, slug: slug || crypto.randomBytes(4).toString('base64url') });
        return res.status(201).json(serialize(req, link));
      } catch (e) {
        if (e.code !== 11000) throw e;
        if (slug) return res.status(409).json({ error: 'Ese slug ya existe' });
      }
    }
    res.status(500).json({ error: 'No se pudo generar un slug único' });
  } catch (e) {
    next(e);
  }
});

api.patch('/links/:id', async (req, res, next) => {
  try {
    if (typeof req.body?.active !== 'boolean') throw new ValidationError('active debe ser boolean');
    const link = await Link.findByIdAndUpdate(req.params.id, { active: req.body.active }, { new: true });
    if (!link) return res.status(404).json({ error: 'No encontrado' });
    res.json(serialize(req, link));
  } catch (e) {
    next(e);
  }
});

api.delete('/links/:id', async (req, res, next) => {
  try {
    const link = await Link.findByIdAndDelete(req.params.id);
    if (!link) return res.status(404).json({ error: 'No encontrado' });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
app.use('/api', api);

// --- Redirect público ---
app.get('/:slug', redirectLimiter, async (req, res, next) => {
  try {
    if (!SLUG_RE.test(req.params.slug)) return res.status(404).send('No encontrado');
    const link = await Link.findOneAndUpdate({ slug: req.params.slug, active: true }, { $inc: { clicks: 1 } });
    if (!link) return res.status(404).send('No encontrado');
    // 302 + no-store: el navegador no cachea y cada visita cuenta.
    res.set('Cache-Control', 'no-store');
    res.redirect(302, link.target);
  } catch (e) {
    next(e);
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  // CastError: id de Mongo malformado en PATCH/DELETE.
  if (err.name === 'CastError') return res.status(400).json({ error: 'ID inválido' });
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

mongoose
  .connect(MONGO_URI)
  .then(() => app.listen(PORT, () => console.log(`Escuchando en :${PORT}`)))
  .catch((e) => {
    console.error('Error conectando a Mongo:', e.message);
    process.exit(1);
  });
