import { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  UsersRound,
} from 'lucide-react';
import AdsGPTLogo from '@/assets/layouts/adsgpt-logo.webp';
import { GA4Events } from '@/utils/ga4';
import { acceptInvitation, getInvitation } from '@/apis/workspaces/workspaceApi';
import {
  featureIdsOf,
  firstAllowedPath,
  normalizeWorkspaceFeatures,
  setWorkspaceToken,
  WORKSPACE_FEATURES,
} from '@/utils/workspaceSession';
import { forgetWorkspaceMagicToken, takeWorkspaceMagicToken } from '@/utils/workspaceMagicLink';

export default function WorkspaceInvitationAcceptPage() {
  const { token: routeToken } = useParams();
  const [token] = useState(() => takeWorkspaceMagicToken('invitation', routeToken));
  const loaded = useRef(false);
  const [invitation, setInvitation] = useState(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({
    firstName: false,
    lastName: false,
    password: false,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(null);
  const [error, setError] = useState('');

  const nameFieldsRequired = !invitation?.existingMember;
  const passwordRequired = !invitation?.hasPassword;
  const nameErrors = {
    firstName: !firstName.trim()
      ? 'First name is required'
      : firstName.trim().length > 80
        ? 'Keep it under 80 characters'
        : '',
    lastName: lastName.trim().length > 80 ? 'Keep it under 80 characters' : '',
  };
  const hasNameErrors = Boolean(nameErrors.firstName || nameErrors.lastName);
  // 8 mirrors the backend's WORKSPACE_PASSWORD_MIN_LENGTH in
  // nodejs-backend/services/workspace/workspaceConfig.js.
  const passwordError = password.length < 8 ? 'Use at least 8 characters' : '';

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    if (!token) {
      setError('Invitation is unavailable');
      setLoading(false);
      return;
    }
    forgetWorkspaceMagicToken('invitation');
    getInvitation(token)
      .then((result) => setInvitation(result.invitation))
      .catch((requestError) =>
        setError(requestError.response?.data?.message || 'Invitation is unavailable')
      )
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    if ((nameFieldsRequired && hasNameErrors) || (passwordRequired && passwordError)) {
      setTouched({ firstName: true, lastName: true, password: true });
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await acceptInvitation(token, { firstName, lastName, password });
      setWorkspaceToken(result.token);
      setAccepted({
        path: firstAllowedPath(result.features),
        workspaceName: invitation?.workspaceName || result.workspaceName || 'your workspace',
      });
      GA4Events.workspaceInvitationAccepted({ source: 'workspace_invitation_accept_page', success: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to accept invitation');
    } finally {
      setSubmitting(false);
    }
  };

  const continueToWorkspace = () => {
    window.location.replace(accepted.path);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0d0d0f] text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[34rem] -translate-x-1/2 rounded-full bg-[#15DCFF]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 left-1/2 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-[#6b72f8]/15 blur-3xl" />

      <header className="relative z-10 flex h-18 items-center justify-between border-b border-white/[0.06] px-5 sm:px-8">
        <img src={AdsGPTLogo} alt="AdsGPT" className="h-9 w-auto" />
        <div className="flex items-center gap-2 text-xs font-medium text-[#BEBEBE]">
          <LockKeyhole className="h-3.5 w-3.5 text-[#15DCFF]" />
          Secure workspace access
        </div>
      </header>

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4.5rem)] w-full max-w-xl items-center px-4 py-10">
        <motion.section
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#141414]/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          {loading ? (
            <div className="flex min-h-80 flex-col items-center justify-center px-6 py-12">
              <Loader2 className="h-7 w-7 animate-spin text-[#15DCFF]" />
              <p className="mt-4 text-sm text-[#BEBEBE]">Checking your invitation…</p>
            </div>
          ) : accepted ? (
            <div className="px-6 py-8 sm:px-9 sm:py-10">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              </div>
              <p className="mt-6 text-xs font-semibold tracking-[0.16em] text-emerald-400 uppercase">
                Invitation accepted
              </p>
              <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
                You now have access to {accepted.workspaceName}
              </h1>
              <p className="mt-3 text-sm leading-6 text-[#BEBEBE]">
                Your workspace profile is ready. Continue to AdsGPT and start using the features
                shared with you.
              </p>

              <div className="mt-6 flex gap-3 rounded-xl border border-[#15DCFF]/15 bg-[#15DCFF]/[0.06] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#15DCFF]/10">
                  <KeyRound className="h-4.5 w-4.5 text-[#15DCFF]" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Your sign-in is ready</p>
                  <p className="mt-1 text-xs leading-5 text-[#BEBEBE]">
                    Next time, open the workspace member sign-in page and enter{' '}
                    <span className="font-medium text-white">{invitation?.email}</span> with the
                    password you just set.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={continueToWorkspace}
                className="mt-7 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-xs font-bold text-white shadow-md transition-all hover:opacity-90"
              >
                Continue to workspace
                <ArrowRight className="h-4 w-4" />
              </button>
              <p className="mt-4 text-center text-xs text-[#BEBEBE]">
                Returning later?{' '}
                <Link to="/workspace-login" className="font-medium text-[#15DCFF] hover:underline">
                  Use workspace member sign in
                </Link>
              </p>
            </div>
          ) : error && !invitation ? (
            <div className="px-6 py-10 text-center sm:px-9">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04]">
                <UsersRound className="h-6 w-6 text-[#BEBEBE]" />
              </div>
              <h1 className="mt-5 text-2xl font-bold">Invitation unavailable</h1>
              <p className="mt-2 text-sm text-red-400">{error}</p>
              <Link
                to="/workspace-login"
                className="mt-7 inline-flex h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-5 text-xs font-semibold transition-all hover:border-white/20 hover:bg-white/[0.08]"
              >
                Workspace member sign in
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <>
              <div className="border-b border-white/[0.06] px-6 py-6 sm:px-9">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-[#02C8C4] to-[#5867EB] ring-1 ring-white/10">
                    <UsersRound className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-[0.16em] text-[#15DCFF] uppercase">
                      You&apos;re invited
                    </p>
                    <h1 className="mt-1 text-xl font-bold sm:text-2xl">
                      Join {invitation?.workspaceName}
                    </h1>
                  </div>
                </div>
              </div>

              <div className="px-6 py-6 sm:px-9 sm:py-8">
                <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
                  <Mail className="h-4 w-4 shrink-0 text-[#BEBEBE]" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold tracking-wider text-white/40 uppercase">
                      Invitation sent to
                    </p>
                    <p className="mt-0.5 truncate text-sm font-medium">{invitation?.email}</p>
                  </div>
                </div>

                <div className="mt-5">
                  <p className="text-xs font-semibold tracking-wider text-white/40 uppercase">
                    Shared features
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {WORKSPACE_FEATURES.filter((feature) =>
                      featureIdsOf(feature).every((id) =>
                        normalizeWorkspaceFeatures(invitation?.features).includes(id)
                      )
                    ).map((feature) => (
                      <span
                        key={featureIdsOf(feature).join('+')}
                        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-[#BEBEBE]"
                      >
                        <Check className="h-3 w-3 text-[#15DCFF]" />
                        {feature.label}
                      </span>
                    ))}
                  </div>
                </div>

                <form onSubmit={submit} className="mt-7">
                  {invitation?.existingMember && !passwordRequired ? (
                    <>
                      <p className="text-sm font-semibold">Workspace profile found</p>
                      <p className="mt-1 text-xs text-[#BEBEBE]">
                        We&apos;ll reuse your existing member profile for this workspace.
                      </p>
                      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
                          <UsersRound className="h-4.5 w-4.5 text-[#15DCFF]" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {invitation.memberName || 'Workspace member'}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[#BEBEBE]">
                            {invitation.email}
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {invitation?.existingMember ? (
                        <>
                          <p className="text-sm font-semibold">
                            Set a password to finish securing your access
                          </p>
                          <p className="mt-1 text-xs text-[#BEBEBE]">
                            We found your existing profile for this workspace. Set a password
                            to sign in from now on.
                          </p>
                          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
                              <UsersRound className="h-4.5 w-4.5 text-[#15DCFF]" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">
                                {invitation.memberName || 'Workspace member'}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-[#BEBEBE]">
                                {invitation.email}
                              </p>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold">Complete your workspace profile</p>
                          <p className="mt-1 text-xs text-[#BEBEBE]">
                            This profile is used to identify you and sign you in to shared
                            workspaces.
                          </p>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <label className="text-xs font-medium text-[#BEBEBE]">
                              First name
                              <input
                                required
                                autoFocus
                                maxLength={80}
                                value={firstName}
                                onChange={(event) => setFirstName(event.target.value)}
                                onBlur={() => setTouched((prev) => ({ ...prev, firstName: true }))}
                                placeholder="First name"
                                aria-invalid={touched.firstName && Boolean(nameErrors.firstName)}
                                className={`mt-2 h-10 w-full rounded-full border bg-[#909294]/15 px-4 text-xs text-white transition-colors outline-none placeholder:text-[#AFAFAF] ${
                                  touched.firstName && nameErrors.firstName
                                    ? 'border-red-500/50 focus:border-red-500/60'
                                    : 'border-white/5 hover:border-white/15 focus:border-[#15DCFF]/40'
                                }`}
                              />
                              {touched.firstName && nameErrors.firstName && (
                                <span className="mt-1.5 block text-[11px] font-normal text-red-400">
                                  {nameErrors.firstName}
                                </span>
                              )}
                            </label>
                            <label className="text-xs font-medium text-[#BEBEBE]">
                              Last name
                              <input
                                maxLength={80}
                                value={lastName}
                                onChange={(event) => setLastName(event.target.value)}
                                onBlur={() => setTouched((prev) => ({ ...prev, lastName: true }))}
                                placeholder="Last name"
                                aria-invalid={touched.lastName && Boolean(nameErrors.lastName)}
                                className={`mt-2 h-10 w-full rounded-full border bg-[#909294]/15 px-4 text-xs text-white transition-colors outline-none placeholder:text-[#AFAFAF] ${
                                  touched.lastName && nameErrors.lastName
                                    ? 'border-red-500/50 focus:border-red-500/60'
                                    : 'border-white/5 hover:border-white/15 focus:border-[#15DCFF]/40'
                                }`}
                              />
                              {touched.lastName && nameErrors.lastName && (
                                <span className="mt-1.5 block text-[11px] font-normal text-red-400">
                                  {nameErrors.lastName}
                                </span>
                              )}
                            </label>
                          </div>
                        </>
                      )}

                      <label className="mt-4 block text-xs font-medium text-[#BEBEBE]">
                        Password
                        <div className="relative mt-2">
                          <input
                            required
                            minLength={8}
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                            placeholder="Create a password"
                            aria-invalid={touched.password && Boolean(passwordError)}
                            className={`h-10 w-full rounded-full border bg-[#909294]/15 px-4 pr-11 text-xs text-white transition-colors outline-none placeholder:text-[#AFAFAF] ${
                              touched.password && passwordError
                                ? 'border-red-500/50 focus:border-red-500/60'
                                : 'border-white/5 hover:border-white/15 focus:border-[#15DCFF]/40'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((prev) => !prev)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            className="absolute top-1/2 right-4 -translate-y-1/2 text-[#AEB5BD] hover:text-white"
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        {touched.password && passwordError && (
                          <span className="mt-1.5 block text-[11px] font-normal text-red-400">
                            {passwordError}
                          </span>
                        )}
                      </label>
                    </>
                  )}
                  {error && (
                    <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-sm text-red-400">
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-xs font-bold text-white shadow-md transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {submitting ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        {invitation?.existingMember && !passwordRequired
                          ? 'Join workspace'
                          : 'Accept invitation'}
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-3">
                  <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[#15DCFF]" />
                  <p className="text-xs leading-5 text-[#BEBEBE]">
                    You&apos;ll sign in with this email address and your password for future
                    visits.
                  </p>
                </div>
              </div>
            </>
          )}
        </motion.section>
      </div>
    </main>
  );
}
