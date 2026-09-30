const crypto = require('crypto');

// Hash antes de comparar: timingSafeEqual exige buffers del mismo largo
// y así no se filtra la longitud de la credencial.
const digest = (s) => crypto.createHash('sha256').update(s).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

function basicAuth(user, password) {
  return (req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const i = decoded.indexOf(':');
      if (i > -1) {
        // Ambas comparaciones se evalúan siempre (sin &&) para no revelar cuál falló.
        const userOk = safeEqual(decoded.slice(0, i), user);
        const passOk = safeEqual(decoded.slice(i + 1), password);
        if (userOk && passOk) return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Admin", charset="UTF-8"');
    res.status(401).json({ error: 'No autorizado' });
  };
}

module.exports = { basicAuth };
