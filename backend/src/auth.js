import { Router } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { checkPassword } from './auth-store.js';

const credentials = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_]+$/),
  email: z.email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
  confirmPassword: z.string(),
}).refine(value => value.password === value.confirmPassword);
const emailInput = z.object({ email: z.email().max(254).transform(value => value.toLowerCase()) });
const passwordInput = z.object({ password: z.string().min(12).max(128), confirmPassword: z.string() })
  .refine(value => value.password === value.confirmPassword);
const cookieName = 'deepresearch_session';
const secure = env => env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT);
const cookie = (value, env) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure(env) ? '; Secure' : ''}`;
const clearCookie = env => `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(env) ? '; Secure' : ''}`;
export const sessionToken = req => req.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);

function mailer(env) {
  if (!env.SMTP_HOST || !env.SMTP_FROM || !env.APP_URL) return null;
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: Number(env.SMTP_PORT || 587) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return async (to, subject, path, value) => {
    const url = new URL(path, env.APP_URL);
    url.searchParams.set('token', value);
    await transporter.sendMail({ from: env.SMTP_FROM, to, subject,
      text: `Open this link to ${subject.toLowerCase()}: ${url.href}\n\nIf you did not request this, ignore this message.`,
    });
  };
}

export function authRouter({ auth, env, sendMail = mailer(env) }) {
  const router = Router();
  const attempts = new Map();
  router.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const key = `${req.ip}:${String(req.body?.email || '').toLowerCase().slice(0, 254)}`;
    const now = Date.now();
    const current = attempts.get(key);
    if (attempts.size > 10000) for (const [entry, state] of attempts) if (state.until < now) attempts.delete(entry);
    if (current?.until > now && current.count >= 12) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    attempts.set(key, { count: current?.until > now ? current.count + 1 : 1, until: now + 15 * 60_000 });
    next();
  });
  router.post('/register', async (req, res) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email, username (3–30 letters, numbers or underscores), and matching passwords of at least 12 characters.' });
    if (!sendMail) return res.status(503).json({ error: 'Email delivery is not configured yet. Please try again later.' });
    const user = await auth.createUser(parsed.data);
    if (!user) return res.status(409).json({ error: 'Email or username is already registered.' });
    try {
      const value = await auth.issueToken(user.id, 'verify', 60 * 24);
      await sendMail(user.email, 'Verify your DeepResearch account', '/verify', value);
    } catch {
      await auth.deleteUnverifiedUser(user.id);
      return res.status(503).json({ error: 'Verification email could not be sent. Please try again later.' });
    }
    res.status(201).json({ message: 'Check your email for a verification link before logging in.' });
  });
  router.post('/verify', async (req, res) => {
    const id = await auth.consumeToken(req.body?.token, 'verify');
    if (!id) return res.status(400).json({ error: 'This verification link is invalid or expired.' });
    await auth.verifyUser(id);
    res.json({ message: 'Email verified. You can now log in.' });
  });
  router.post('/login', async (req, res) => {
    const email = emailInput.safeParse(req.body);
    if (!email.success || typeof req.body?.password !== 'string') return res.status(400).json({ error: 'Enter your email and password.' });
    const user = await auth.findUser(email.data.email);
    if (!user || user.demo || !await checkPassword(req.body.password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!user.verified) return res.status(403).json({ error: 'Verify your email before logging in.' });
    res.set('Set-Cookie', cookie(await auth.createSession(user.id), env));
    res.json({ user: { id: user.id, username: user.username, email: user.email, demo: false } });
  });
  router.post('/demo', async (req, res) => {
    const user = await auth.demoUser();
    res.set('Set-Cookie', cookie(await auth.createSession(user.id), env));
    res.json({ user: { id: user.id, username: user.username, email: user.email, demo: true } });
  });
  router.get('/me', async (req, res) => {
    const user = await auth.sessionUser(sessionToken(req));
    if (!user) return res.status(401).json({ error: 'Login required.' });
    res.json({ user });
  });
  router.post('/logout', async (req, res) => {
    await auth.deleteSession(sessionToken(req));
    res.set('Set-Cookie', clearCookie(env));
    res.json({ message: 'Logged out.' });
  });
  router.post('/forgot-password', async (req, res) => {
    const email = emailInput.safeParse(req.body);
    if (!email.success) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!sendMail) return res.status(503).json({ error: 'Email delivery is not configured yet.' });
    const user = await auth.findUser(email.data.email);
    if (user?.verified && !user.demo) {
      try {
        const value = await auth.issueToken(user.id, 'reset', 30);
        await sendMail(user.email, 'Reset your DeepResearch password', '/reset-password', value);
      } catch { return res.status(503).json({ error: 'Email could not be sent. Please try again later.' }); }
    }
    res.json({ message: 'If that verified email is registered, a reset link has been sent.' });
  });
  router.post('/reset-password', async (req, res) => {
    const parsed = passwordInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter matching passwords of at least 12 characters.' });
    const id = await auth.consumeToken(req.body?.token, 'reset');
    if (!id) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
    await auth.resetPassword(id, parsed.data.password);
    res.set('Set-Cookie', clearCookie(env));
    res.json({ message: 'Password updated. Please log in again.' });
  });
  return router;
}
