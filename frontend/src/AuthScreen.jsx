import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Telescope } from 'lucide-react';

async function send(path, body) {
  const response = await fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}

export default function AuthScreen({ onLogin }) {
  const location = useLocation();
  const navigate = useNavigate();
  const page = ['/register', '/forgot-password', '/reset-password', '/verify'].includes(location.pathname) ? location.pathname : '/login';
  const token = new URLSearchParams(location.search).get('token');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { setError(''); setMessage(''); }, [page]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (page === '/register') setMessage((await send('register', data)).message);
      else if (page === '/forgot-password') setMessage((await send('forgot-password', data)).message);
      else if (page === '/verify') setMessage((await send('verify', { token })).message);
      else if (page === '/reset-password') setMessage((await send('reset-password', { ...data, token })).message);
      else { onLogin((await send('login', data)).user); navigate('/'); }
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  async function demo() {
    setBusy(true); setError('');
    try { onLogin((await send('demo', {})).user); navigate('/'); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  const titles = { '/login': 'Welcome back', '/register': 'Create your account', '/verify': 'Verify your email', '/forgot-password': 'Reset your password', '/reset-password': 'Choose a new password' };
  return <div className="auth-page"><div className="auth-card">
    <div className="auth-brand"><Telescope size={24}/> deepresearch</div>
    <h1>{titles[page]}</h1>
    <p className="auth-intro">Your research and documents stay in your own workspace.</p>
    {page === '/verify' && !token && <p role="alert" className="error-message">This verification link is incomplete.</p>}
    {page === '/reset-password' && !token && <p role="alert" className="error-message">This reset link is incomplete.</p>}
    <form onSubmit={submit}>
      {page === '/register' && <label>Username<input name="username" autoComplete="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]+" /></label>}
      {['/login', '/register', '/forgot-password'].includes(page) && <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>}
      {['/login', '/register', '/reset-password'].includes(page) && <label>Password<input name="password" type="password" autoComplete={page === '/login' ? 'current-password' : 'new-password'} required minLength={page === '/login' ? 1 : 12} maxLength={128}/></label>}
      {['/register', '/reset-password'].includes(page) && <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {message && <p role="status" className="auth-message">{message}</p>}
      <button className="auth-primary" type="submit" disabled={busy || (['/verify', '/reset-password'].includes(page) && !token)}>{busy ? 'Please wait…' : page === '/register' ? 'Create account' : page === '/verify' ? 'Verify email' : page === '/forgot-password' ? 'Send reset link' : page === '/reset-password' ? 'Set new password' : 'Log in'}</button>
    </form>
    {page === '/login' && <><button className="auth-demo" type="button" disabled={busy} onClick={demo}>Try the demo account</button><p className="auth-foot">No email needed. Demo runs use sample data and share one demo workspace.</p><div className="auth-links"><NavLink to="/register">Create an account</NavLink><NavLink to="/forgot-password">Forgot password?</NavLink></div></>}
    {page !== '/login' && <p className="auth-foot"><NavLink to="/login">Back to login</NavLink></p>}
  </div></div>;
}
