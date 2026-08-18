// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { Mail, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import UserProfilePage from '@/pages/Profile/UserProfilePage';
import {
  featureIdsOf,
  isWorkspaceMember,
  normalizeWorkspaceFeatures,
  sessionPayload,
  WORKSPACE_FEATURES,
} from '@/utils/workspaceSession';

export default function WorkspaceProfilePage() {
  const payload = sessionPayload();
  if (!isWorkspaceMember(payload)) return <UserProfilePage />;

  const normalizedFeatures = normalizeWorkspaceFeatures(payload.workspace_features);
  const featureLabels = WORKSPACE_FEATURES.filter((feature) =>
    featureIdsOf(feature).every((id) => normalizedFeatures.includes(id))
  ).map(({ label }) => label);

  return (
    <div className="workspace-profile-page relative -m-4 min-h-full bg-[#F7F4EE] p-4 text-[#24211D] transition-colors duration-200 sm:p-6 dark:m-0 dark:min-h-0 dark:bg-transparent dark:p-0 dark:text-white">
      <div className="relative mx-auto w-full max-w-3xl pt-4 pb-16">
        <div className="pointer-events-none absolute -top-20 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-[#EADFD0]/25 blur-3xl dark:bg-white/[0.025]" />
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className="relative overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] text-[#24211D] shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05),0_2px_6px_-1px_rgba(80,70,58,0.03)] backdrop-blur-md dark:border-white/10 dark:bg-[#121214] dark:text-white dark:shadow-none"
        >
          <div className="border-b border-[#DDD7CD] bg-[#FCFAF7] px-6 py-6 dark:border-white/[0.07] dark:bg-white/[0.02]">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#24211D] text-base font-semibold text-[#FAF8F5] shadow-xs dark:bg-gradient-to-r dark:from-[#02C8C4] dark:to-[#5867EB] dark:ring-1 dark:ring-white/10">
                {(payload.actorUserName || payload.actorUserEmail || 'M').slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-[#02A8A4] uppercase dark:text-cyan-500">
                  Workspace member
                </p>
                <h1 className="mt-1 text-xl font-semibold text-[#24211D] dark:text-white">
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
              className="rounded-2xl border border-[#DDD7CD] bg-[#EAE5DC]/60 p-4 transition-colors hover:bg-[#EAE5DC]/90 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#EAE5DC] text-[#24211D] ring-1 ring-[#DDD7CD] dark:bg-gradient-to-br dark:from-[#15DCFF]/15 dark:to-[#6b72f8]/15 dark:text-[#15DCFF] dark:ring-white/10">
                <Mail className="h-4 w-4" />
              </div>
              <p className="mt-3 text-xs text-[#7A7369] dark:text-zinc-500">Email</p>
              <p className="mt-1 truncate text-sm font-medium text-[#24211D] dark:text-white">{payload.actorUserEmail}</p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.09 }}
              className="rounded-2xl border border-[#DDD7CD] bg-[#EAE5DC]/60 p-4 transition-colors hover:bg-[#EAE5DC]/90 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#EAE5DC] text-[#24211D] ring-1 ring-[#DDD7CD] dark:bg-gradient-to-br dark:from-[#15DCFF]/15 dark:to-[#6b72f8]/15 dark:text-[#15DCFF] dark:ring-white/10">
                <UsersRound className="h-4 w-4" />
              </div>
              <p className="mt-3 text-xs text-[#7A7369] dark:text-zinc-500">Current workspace</p>
              <p className="mt-1 truncate text-sm font-medium text-[#24211D] dark:text-white">{payload.workspace_name}</p>
            </motion.div>
          </div>

          <div className="border-t border-[#DDD7CD] px-6 py-6 dark:border-white/[0.07]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#02A8A4] dark:text-cyan-500" />
              <h2 className="text-sm font-semibold text-[#24211D] dark:text-white">Assigned access</h2>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {featureLabels.map((label) => (
                <span
                  key={label}
                  className="workspace-pill rounded-full border border-[#DDD7CD] bg-[#FCFAF7] px-3 py-1.5 text-xs font-medium text-[#3D3831] shadow-[0_1px_2px_rgba(80,70,58,0.04)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-[#BEBEBE]"
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#DDD7CD] bg-[#EAE5DC]/50 p-4 dark:border-cyan-500/20 dark:bg-cyan-500/[0.08]">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[#02A8A4] dark:text-cyan-500" />
              <p className="text-xs leading-5 text-[#544D44] dark:text-[#BEBEBE]">
                Your workspace owner controls feature access. This member profile never exposes the
                owner&apos;s billing, subscription, credits, or personal profile.
              </p>
            </div>
          </div>
        </motion.section>
      </div>
    </div>
  );
}
