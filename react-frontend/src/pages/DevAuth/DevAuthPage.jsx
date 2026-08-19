import React, { useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { Loader2 } from 'lucide-react';

/**
 * /dev-auth — internal helper to set the access-token cookie from a JWT
 * passed in the URL hash, then hand off to the target route.
 *
 * Must be mounted OUTSIDE `RunBackLog` / `AuthWrapper` so it runs before
 * the normal aMember redirect kicks in.
 *
 * Usage:
 *   /dev-auth#t=<jwt>
 *   /dev-auth#t=<jwt>&to=/autopilot          (custom landing page)
 *
 * The JWT lives in the URL **hash**, not the query string — hashes never
 * travel to the server, so the token won't land in nginx / GitHub Actions
 * / referer logs. Cookie is set on `.poweradspy.com` to match what
 * RunBackLog writes on a real aMember sign-in, so subdomain routing works.
 */
const DevAuthPage = () => {
  const [status, setStatus] = useState('setting');
  const [message, setMessage] = useState('');

  useEffect(() => {
    try {
      // Hash may arrive as `#t=…&to=/autopilot` — strip the leading `#`.
      const raw = (window.location.hash || '').replace(/^#/, '');
      const params = new URLSearchParams(raw);
      const token = params.get('t');
      const to = params.get('to') || '/autopilot';

      if (!token) {
        setStatus('error');
        setMessage(
          "Missing token. Expected format: /dev-auth#t=<JWT>. The 't' param lives in the URL hash (after #), not the query string."
        );
        return;
      }

      // Cookie domain == leading-dot + last two hostname segments.
      // Mirrors RunBackLog's domain computation so amember + dev-auth
      // hand-offs use the same cookie.
      const parts = window.location.hostname.split('.');
      const domain =
        parts.length >= 2 ? `.${parts.slice(-2).join('.')}` : window.location.hostname;

      Cookies.set('access-token', token, {
        expires: 1, // js-cookie interprets 1 as 1 day
        path: '/',
        secure: window.location.protocol === 'https:',
        sameSite: 'lax',
        domain,
      });

      // Clear the hash so the token doesn't sit in the browser URL bar
      // after the redirect. Then hop to the target page.
      window.history.replaceState(null, '', window.location.pathname);
      setStatus('ok');
      const isSafeRedirectUrl = (urlStr) => {
        if (!urlStr || typeof urlStr !== 'string') return false;
        const clean = urlStr.trim();
        if (/^(javascript|data|vbscript):/i.test(clean)) return false;
        if (clean.startsWith('/') && !clean.startsWith('//') && !clean.startsWith('/\\')) return true;
        try {
          return new URL(clean, window.location.origin).origin === window.location.origin;
        } catch {
          return false;
        }
      };
      window.location.href = isSafeRedirectUrl(to) ? to : '/';
    } catch (err) {
      setStatus('error');
      setMessage(err && err.message ? err.message : String(err));
    }
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        {status === 'setting' && (
          <>
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-muted-foreground text-sm">
              Setting session cookie…
            </p>
          </>
        )}
        {status === 'ok' && (
          <p className="text-muted-foreground text-sm">Redirecting…</p>
        )}
        {status === 'error' && (
          <div className="max-w-md rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <strong>dev-auth error:</strong>
            <div className="mt-1">{message}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DevAuthPage;
