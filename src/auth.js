import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Bearer JWT, one shared password, one role. The algorithm is pinned so a
// forged `alg: none` token is rejected.
export function authenticate(config) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    try {
      jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      next();
    } catch (err) {
      const expired = err?.name === 'TokenExpiredError';
      res.status(401).json({ error: expired ? 'Session expired. Please log in again.' : 'Invalid token' });
    }
  };
}

export function authRoutes(app, config) {
  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { password } = req.body ?? {};
    if (!password || typeof password !== 'string') return res.status(400).json({ error: 'Password is required' });
    if (password.length > 128) return res.status(400).json({ error: 'Password too long' });
    try {
      const match = await bcrypt.compare(password, config.passwordHash);
      if (!match) return res.status(401).json({ error: 'Incorrect password' });
      const token = jwt.sign({ role: 'admin' }, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.jwtExpiresIn });
      res.json({ token });
    } catch {
      res.status(500).json({ error: 'Authentication failed' });
    }
  });

  app.get('/api/auth/verify', authenticate(config), (_req, res) => {
    res.json({ valid: true });
  });
}
