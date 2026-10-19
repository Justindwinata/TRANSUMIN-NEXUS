'use client';

import { useState, type FormEvent } from 'react';
import { opsApi } from '../../lib/ops-api';
import type { OperatorPrincipal } from '../../lib/ops';

export function LoginView({
  onLogin,
}: {
  onLogin?: (principal: OperatorPrincipal) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('submitting');
    setMessage('');
    try {
      const result = await opsApi.login(email, password);
      onLogin?.(result);
      window.location.assign('/ops/network');
    } catch (cause) {
      setState('error');
      setMessage(cause instanceof Error ? cause.message : 'Login failed.');
    }
  }
  return (
    <main className="ops-auth-state">
      <form className="ops-login" onSubmit={submit}>
        <p className="ops-eyebrow">TRANSUM-IN / OPERATOR ACCESS</p>
        <h1>Sign in</h1>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button disabled={state === 'submitting'}>
          {state === 'submitting' ? 'Signing in…' : 'Sign in'}
        </button>
        {message && (
          <p className="ops-form-error" role="alert">
            {message}
          </p>
        )}
      </form>
    </main>
  );
}

export function RoleAwareNavigation({
  principal,
  onLogout,
}: {
  principal: OperatorPrincipal;
  onLogout?: () => void;
}) {
  const [state, setState] = useState<'idle' | 'busy'>('idle');
  async function logout() {
    setState('busy');
    try {
      await opsApi.logout();
      onLogout?.();
      window.location.assign('/ops/login');
    } finally {
      setState('idle');
    }
  }
  return (
    <div className="ops-identity">
      <strong>{principal.email}</strong>
      <small>{principal.roles.join(' / ')}</small>
      {principal.roles.includes('ADMIN') && (
        <a href="/ops/admin">Account provisioning</a>
      )}
      <button
        className="ops-link-button"
        disabled={state === 'busy'}
        onClick={logout}
      >
        {state === 'busy' ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

export function AdminAccountProvisioning({
  principal,
}: {
  principal: OperatorPrincipal;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('RESEARCHER_OPERATOR');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await opsApi.provision(email, password, [role]);
      setMessage('Account provisioned.');
      setEmail('');
      setPassword('');
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : 'Provisioning failed.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!principal.roles.includes('ADMIN'))
    return (
      <main className="ops-auth-state">
        <h1>Access denied</h1>
        <p>ADMIN role required.</p>
      </main>
    );
  return (
    <main className="ops-shell">
      <section className="ops-admin-form">
        <p className="ops-eyebrow">ADMIN / ACCOUNT PROVISIONING</p>
        <h1>Create account</h1>
        <form onSubmit={submit}>
          <label htmlFor="provision-email">Email</label>
          <input
            id="provision-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="provision-password">Temporary password</label>
          <input
            id="provision-password"
            type="password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <label htmlFor="provision-role">Role</label>
          <select
            id="provision-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="RESEARCHER_OPERATOR">RESEARCHER_OPERATOR</option>
            <option value="ADMIN">ADMIN</option>
            <option value="PASSENGER">PASSENGER</option>
          </select>
          <button disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          {message && <p role="status">{message}</p>}
        </form>
      </section>
    </main>
  );
}
