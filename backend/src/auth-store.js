import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const publicUser = row => row && ({ id: row.id, username: row.username, email: row.email, verified: row.verified, demo: row.demo });

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function checkPassword(password, encoded) {
  const [salt, hex] = String(encoded || '').split(':');
  if (!salt || !/^[0-9a-f]{128}$/.test(hex || '')) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hex, 'hex'));
}

export async function initializeAuth(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY, username varchar(30) NOT NULL,
    email varchar(254) NOT NULL UNIQUE, password_hash text NOT NULL,
    verified boolean NOT NULL DEFAULT false, demo boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));
  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose varchar(12) NOT NULL, expires_at timestamptz NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id);
  CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens (user_id, purpose);`);
  await pool.query(`INSERT INTO users (id, username, email, password_hash, verified, demo)
    VALUES ($1, 'demo', 'demo@deepresearch.invalid', $2, true, true)
    ON CONFLICT (email) DO NOTHING`, [randomUUID(), await hashPassword(token())]);
}

export function authStore(pool) {
  return {
    async createUser({ username, email, password }) {
      const id = randomUUID();
      try {
        const result = await pool.query('INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, username, email, verified, demo', [id, username, email, await hashPassword(password)]);
        return publicUser(result.rows[0]);
      } catch (error) {
        if (error.code === '23505') return null;
        throw error;
      }
    },
    async deleteUnverifiedUser(id) { await pool.query('DELETE FROM users WHERE id = $1 AND verified = false', [id]); },
    async findUser(email) { return (await pool.query('SELECT * FROM users WHERE email = $1', [email])).rows[0]; },
    async demoUser() { return (await pool.query("SELECT * FROM users WHERE email = 'demo@deepresearch.invalid' AND demo = true")).rows[0]; },
    async issueToken(userId, purpose, minutes) {
      const value = token();
      await pool.query('DELETE FROM auth_tokens WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
      await pool.query('INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, now() + ($4 * interval \'1 minute\'))', [digest(value), userId, purpose, minutes]);
      return value;
    },
    async consumeToken(value, purpose) {
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
      const result = await pool.query('DELETE FROM auth_tokens WHERE token_hash = $1 AND purpose = $2 AND expires_at > now() RETURNING user_id', [digest(value), purpose]);
      return result.rows[0]?.user_id || null;
    },
    async verifyUser(id) { await pool.query('UPDATE users SET verified = true WHERE id = $1', [id]); },
    async resetPassword(id, password) {
      await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1 AND demo = false', [id, await hashPassword(password)]);
      await pool.query('DELETE FROM auth_sessions WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM auth_tokens WHERE user_id = $1', [id]);
    },
    async createSession(userId) {
      const value = token();
      await pool.query("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')", [digest(value), userId]);
      return value;
    },
    async sessionUser(value) {
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
      const row = (await pool.query('SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()', [digest(value)])).rows[0];
      return publicUser(row);
    },
    async deleteSession(value) { if (value) await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [digest(value)]); },
  };
}
