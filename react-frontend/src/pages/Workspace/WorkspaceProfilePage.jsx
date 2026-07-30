// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { Mail, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import UserProfilePage from '@/pages/Profile/UserProfilePage';
import {
  isWorkspaceMember,
  normalizeWorkspaceFeatures,
  sessionPayload,
  WORKSPACE_FEATURES,
} from '@/utils/workspaceSession';

export default function WorkspaceProfilePage() {
  const payload = sessionPayload();
  if (!isWorkspaceMember(payload)) return <UserProfilePage />;

  const normalizedFeatures = normalizeWorkspaceFeatures(payload.workspace_features);
  const featureLabels = WORKSPACE_FEATURES.filter(({ id }) => normalizedFeatures.includes(id)).map(
    ({ label }) => label
  );

  return (
    <div className="relative mx-auto w-full max-w-3xl px-5 pt-8 pb-16 text-gray-900 dark:text-white">
      <div className="pointer-events-none absolute -top-20 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-gray-200/50 blur-3xl dark:bg-white/[0.025]" />
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#0D0D0D]/60"
      >
        <div className="border-b border-gray-200 px-6 py-6 dark:border-white/[0.07]">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-base font-bold text-white ring-1 ring-white/10">
              {(payload.actorUserName || payload.actorUserEmail || 'M').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-cyan-500 uppercase">
                Workspace member
              </p>
              <h1 className="mt-1 text-xl font-semibold">
                {payload.actorUserName || 'Workspace member'}
              </h1>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-6 sm:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.05 }}
            className="rounded-2xl border border-gray-200 bg-gray-50 p-4 transition-colors hover:border-gray-300 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:border-white/10"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
              <Mail className="h-4 w-4 text-[#15DCFF]" />
            </div>
            <p className="mt-3 text-xs text-zinc-500">Email</p>
            <p className="mt-1 truncate text-sm font-medium">{payload.actorUserEmail}</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.09 }}
            className="rounded-2xl border border-gray-200 bg-gray-50 p-4 transition-colors hover:border-gray-300 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:border-white/10"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
              <UsersRound className="h-4 w-4 text-[#15DCFF]" />
            </div>
            <p className="mt-3 text-xs text-zinc-500">Current workspace</p>
            <p className="mt-1 truncate text-sm font-medium">{payload.workspace_name}</p>
          </motion.div>
        </div>

        <div className="border-t border-gray-200 px-6 py-6 dark:border-white/[0.07]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-500" />
            <h2 className="text-sm font-semibold">Assigned access</h2>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {featureLabels.map((label) => (
              <span
                key={label}
                className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-[#BEBEBE]"
              >
                {label}
              </span>
            ))}
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-cyan-500/15 bg-cyan-500/[0.06] p-4">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
            <p className="text-xs leading-5 text-zinc-500 dark:text-[#BEBEBE]">
              Your workspace owner controls feature access. This member profile never exposes the
              owner&apos;s billing, subscription, credits, or personal profile.
            </p>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
