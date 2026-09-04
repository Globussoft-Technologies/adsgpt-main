import { useState } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import AdsGPTLogo from '@/assets/layouts/adsgpt-logo.webp';
import AdsGPTLightModeLogo from '@/assets/layouts/adsgpt-light-mode-logo.png';
import { loginMember } from '@/apis/workspaces/workspaceApi';
import { firstAllowedPath, setWorkspaceToken } from '@/utils/workspaceSession';

export default function WorkspaceMemberLoginPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() =>
    params.get('reason') === 'access-changed'
      ? 'Your workspace access changed. Sign in again to continue.'
      : ''
  );

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await loginMember(email.trim(), password);
      setWorkspaceToken(result.token);
      window.location.replace(firstAllowedPath(result.features));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Incorrect email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#F7F4EE] px-4 py-10 text-zinc-900 transition-colors dark:bg-[#0D0D0D] dark:text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03] dark:opacity-[0.025]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="pointer-events-none absolute -top-28 left-1/2 h-72 w-[34rem] -translate-x-1/2 rounded-full bg-[#5867EB]/10 blur-3xl" />

      <motion.section
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] px-7 py-8 shadow-2xl shadow-zinc-300/40 backdrop-blur-xl sm:px-10 sm:py-10 dark:border-white/10 dark:bg-[#141414]/95 dark:shadow-black/40"
      >
        <img src={AdsGPTLightModeLogo} alt="AdsGPT" className="mx-auto h-auto w-[176px] dark:hidden" />
        <img src={AdsGPTLogo} alt="AdsGPT" className="mx-auto hidden h-auto w-[176px] dark:block" />

        <div className="mt-7 text-center">
          <h1 className="text-[27px] font-semibold tracking-tight text-zinc-900 dark:text-white">Workspace member sign in</h1>
          <p className="mt-2 text-[17px] text-zinc-600 dark:text-[#AEB5BD]">Access your shared workspace</p>
        </div>

        <form onSubmit={submit} className="mt-10 space-y-4">
          <div className="relative">
            <Mail className="absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-[#AEB5BD]" />
            <input
              id="workspace-member-email"
              required
              autoFocus
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email address"
              aria-label="Email address"
              className="h-10 w-full rounded-full border border-[#DDD7CD] bg-white pr-4 pl-11 text-xs text-zinc-900 transition-colors outline-none placeholder:text-zinc-400 hover:border-zinc-400 focus:border-[#02C8C4] dark:border-white/5 dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 dark:focus:border-[#15DCFF]/40"
            />
          </div>

          <div className="relative">
            <Lock className="absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-[#AEB5BD]" />
            <input
              id="workspace-member-password"
              required
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              aria-label="Password"
              className="h-10 w-full rounded-full border border-[#DDD7CD] bg-white pr-11 pl-11 text-xs text-zinc-900 transition-colors outline-none placeholder:text-zinc-400 hover:border-zinc-400 focus:border-[#02C8C4] dark:border-white/5 dark:bg-[#909294]/15 dark:text-white dark:placeholder:text-[#AFAFAF] dark:hover:border-white/15 dark:focus:border-[#15DCFF]/40"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute top-1/2 right-4 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:text-[#AEB5BD] dark:hover:text-white"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm leading-5 text-red-600 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-xs font-bold text-white shadow-md transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                Sign in
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 border-t border-[#DDD7CD] pt-6 text-center dark:border-white/10">
          <p className="text-xs leading-5 text-zinc-500 dark:text-[#AEB5BD]">
            Locked out? Ask your workspace owner to send you a new invite.
          </p>
        </div>
      </motion.section>
    </main>
  );
}
