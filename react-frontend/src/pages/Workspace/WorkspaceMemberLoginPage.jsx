import { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Loader2, Mail } from 'lucide-react';
import AdsGPTLogo from '@/assets/layouts/adsgpt-logo.webp';
import { consumeMemberLogin, requestMemberLogin } from '@/apis/workspaces/workspaceApi';
import { firstAllowedPath, setWorkspaceToken } from '@/utils/workspaceSession';
import { forgetWorkspaceMagicToken, takeWorkspaceMagicToken } from '@/utils/workspaceMagicLink';

export default function WorkspaceMemberLoginPage() {
  const [params] = useSearchParams();
  const [token] = useState(() => takeWorkspaceMagicToken('login', params.get('token')));
  const consumed = useRef(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(Boolean(token));
  const [message, setMessage] = useState('');
  const [error, setError] = useState(() =>
    params.get('reason') === 'access-changed'
      ? 'Your workspace access changed. Request a new sign-in link to continue.'
      : ''
  );

  useEffect(() => {
    if (!token || consumed.current) return;
    consumed.current = true;
    forgetWorkspaceMagicToken('login');
    consumeMemberLogin(token)
      .then((result) => {
        setWorkspaceToken(result.token);
        window.location.replace(firstAllowedPath(result.features));
      })
      .catch((requestError) => {
        setError(requestError.response?.data?.message || 'Sign-in link is invalid');
        setLoading(false);
      });
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      await requestMemberLogin(email.trim());
      setMessage(email.trim());
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to request sign-in link');
    } finally {
      setLoading(false);
    }
  };

  const useAnotherEmail = () => {
    setMessage('');
    setEmail('');
    setError('');
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0D0D0D] px-4 py-10 text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="pointer-events-none absolute -top-28 left-1/2 h-72 w-[34rem] -translate-x-1/2 rounded-full bg-[#5867EB]/10 blur-3xl" />

      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#141414]/95 px-7 py-8 shadow-2xl shadow-black/40 backdrop-blur-xl sm:px-10 sm:py-10"
      >
        <img src={AdsGPTLogo} alt="AdsGPT" className="mx-auto h-auto w-[176px]" />

        {token && loading ? (
          <div className="flex min-h-64 flex-col items-center justify-center text-center">
            <Loader2 className="h-7 w-7 animate-spin text-[#15DCFF]" />
            <h1 className="mt-5 text-[24px] font-semibold">Signing you in</h1>
            <p className="mt-2 text-sm text-[#AEB5BD]">Verifying your secure workspace link…</p>
          </div>
        ) : message ? (
          <div className="pt-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/12">
              <CheckCircle2 className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="mt-5 text-[27px] font-semibold tracking-tight">Check your inbox</h1>
            <p className="mt-3 text-[15px] leading-6 text-[#AEB5BD]">
              If <span className="font-medium text-white">{message}</span> has workspace access,
              we&apos;ve sent a secure one-time sign-in link.
            </p>
            <p className="mt-4 text-xs leading-5 text-[#89939D]">
              The link expires shortly and can only be used once. Check your spam folder if it
              doesn&apos;t arrive.
            </p>
            <button
              type="button"
              onClick={useAnotherEmail}
              className="mt-7 h-10 w-full rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-xs font-bold text-white shadow-md transition-all hover:opacity-90"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <div className="mt-7 text-center">
              <h1 className="text-[27px] font-semibold tracking-tight">Workspace member sign in</h1>
              <p className="mt-2 text-[17px] text-[#AEB5BD]">Access your shared workspace</p>
            </div>

            <form onSubmit={submit} className="mt-10">
              <div className="relative">
                <Mail className="absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-[#AEB5BD]" />
                <input
                  id="workspace-member-email"
                  required
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email address"
                  aria-label="Email address"
                className="h-10 w-full rounded-full border border-white/5 bg-[#909294]/15 pr-4 pl-11 text-xs text-white transition-colors outline-none placeholder:text-[#AFAFAF] hover:border-white/15 focus:border-[#15DCFF]/40"
                />
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm leading-5 text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-xs font-bold text-white shadow-md transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Email sign-in link
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 border-t border-white/10 pt-6 text-center">
              <p className="text-sm font-medium text-white">No password required</p>
              <p className="mt-1.5 text-xs leading-5 text-[#AEB5BD]">
                We&apos;ll email you a secure one-time link whenever you sign in.
              </p>
            </div>
          </>
        )}
      </motion.section>
    </main>
  );
}
