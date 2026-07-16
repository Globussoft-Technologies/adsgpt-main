import React, { useEffect, useState } from 'react';
import Cookies from 'js-cookie';

/**
 * /oauth/relay — the login bridge between AdsGPT's OAuth Authorization
 * Server (backend) and aMember.
 *
 * Why this exists:
 *   The AS backend needs an `access-token` JWT cookie to identify the
 *   signed-in user. That cookie isn't set by aMember directly — the aMember
 *   login form drops `amember_login` / `amember_pass` cookies, and the
 *   frontend's RunBackLog trades those for a JWT via
 *   `/adsgpt/check-access/by-login-pass`, then sets `access-token`.
 *
 *   When the AS 302s to aMember and aMember 302s back directly to the AS,
 *   nothing ever runs that trade → the AS thinks the user is still logged
 *   out → sends them back to aMember → redirect loop.
 *
 *   This page is the missing piece: it runs after aMember, does the same
 *   trade RunBackLog does, then forwards to the AS's original /oauth/authorize
 *   URL (passed in as ?returnTo=...).
 *
 * Mounted OUTSIDE the RunBackLog / AuthWrapper stack — this component owns
 * its own lifecycle. Don't rewire it under those wrappers; they'll fight
 * over the same cookie logic.
 */

const HOST = import.meta.env.VITE_SOCKET_URL;
const AMEMBER_URL = import.meta.env.VITE_AMEMBER_URL;

const cookieDomain = () => {
  const parts = window.location.hostname.split('.');
  return parts.length >= 2
    ? `.${parts.slice(-2).join('.')}`
    : window.location.hostname;
};

const OAuthRelayPage = () => {
  const [message, setMessage] = useState('Signing you in…');
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get('returnTo');

    if (!returnTo) {
      setIsError(true);
      setMessage(
        'Missing returnTo parameter. Restart the sign-in from the application that sent you here.',
      );
      return;
    }

    (async () => {
      // Case 1 — already signed in to AdsGPT. Forward immediately.
      const existingToken = Cookies.get('access-token');
      if (existingToken) {
        window.location.href = returnTo;
        return;
      }

      // Case 2 — aMember just handed us plaintext creds via cookies (this
      // is how the custom aMember login form works). Trade for a JWT via
      // the same endpoint RunBackLog uses.
      const userName = Cookies.get('amember_login');
      const password = Cookies.get('amember_pass');
      if (userName && password) {
        try {
          const res = await fetch(
            `${HOST}/adsgpt/check-access/by-login-pass`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({ login: userName, pass: password }),
            },
          );
          const result = JSON.parse(await res.text());

          if (result?.expired === true) {
            setIsError(true);
            setMessage(
              'Your AdsGPT plan has expired. Renew your subscription and try again.',
            );
            return;
          }
          if (!result?.ok || !result?.token) {
            setIsError(true);
            setMessage('Sign-in failed. Please try again.');
            return;
          }

          const domain = cookieDomain();
          Cookies.set('access-token', result.token, {
            expires: 1,
            path: '/',
            secure: window.location.protocol === 'https:',
            sameSite: 'lax',
            domain,
          });
          // Wipe plaintext credentials once they've been traded.
          Cookies.remove('amember_login', { domain, path: '/' });
          Cookies.remove('amember_pass', { domain, path: '/' });

          window.location.href = returnTo;
          return;
        } catch (err) {
          setIsError(true);
          setMessage('Sign-in failed: ' + (err?.message || String(err)));
          return;
        }
      }

      // Case 3 — no session, no credentials. Kick off aMember login and
      // ask it to bounce back HERE (so this same useEffect re-runs after
      // sign-in, this time with the amember cookies present → Case 2).
      const self = window.location.href;
      if (!AMEMBER_URL) {
        setIsError(true);
        setMessage(
          'VITE_AMEMBER_URL is not configured. Cannot redirect to sign-in.',
        );
        return;
      }
      window.location.href = `${AMEMBER_URL}/login?amember_redirect_url=${encodeURIComponent(self)}`;
    })();
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0F0F0F',
        color: isError ? '#F87171' : '#AFAFAF',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 480, fontSize: 14, lineHeight: 1.5 }}>
        {message}
      </div>
    </div>
  );
};

export default OAuthRelayPage;
