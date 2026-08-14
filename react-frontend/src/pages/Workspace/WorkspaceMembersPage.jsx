import { useCallback, useEffect, useState } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  Clock3,
  Loader2,
  Mail,
  Minus,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { GA4Events } from '@/utils/ga4';
import {
  getWorkspaces,
  inviteMember,
  removeMember,
  revokeInvitation,
  updateMemberFeatures,
} from '@/apis/workspaces/workspaceApi';
import {
  ASSIGNABLE_WORKSPACE_FEATURES,
  WORKSPACE_FEATURE_GROUPS,
  WORKSPACE_FEATURES,
  featureIdsOf,
  normalizeWorkspaceFeatures,
} from '@/utils/workspaceSession';

const requestErrorMessage = (requestError, fallback) =>
  requestError.response?.data?.message || requestError.message || fallback;

const allLeafFeatureIds = WORKSPACE_FEATURES.flatMap(featureIdsOf);
const allAssignableFeatureIds = ASSIGNABLE_WORKSPACE_FEATURES.flatMap(featureIdsOf);

function featurePicker(selected, setSelected) {
  const isFeatureActive = (feature) => featureIdsOf(feature).every((id) => selected.includes(id));

  const toggleFeature = (feature) => {
    const ids = featureIdsOf(feature);
    const active = ids.every((id) => selected.includes(id));
    setSelected((current) =>
      active
        ? current.filter((id) => !ids.includes(id))
        : [...current, ...ids.filter((id) => !current.includes(id))]
    );
  };

  const toggleGroup = (group) => {
    const availableIds = group.features
      .filter(({ available }) => available)
      .flatMap(featureIdsOf);
    const allSelected = availableIds.every((id) => selected.includes(id));
    setSelected((current) => {
      const next = new Set(current);
      availableIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return allLeafFeatureIds.filter((id) => next.has(id));
    });
  };

  return (
    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2">
      {WORKSPACE_FEATURE_GROUPS
        // A matrix group (Ads Manager) deliberately keeps its unavailable
        // cells visible as "Soon" — a roadmap preview. Everywhere else, a
        // feature gated off by a build flag (e.g. AI Assistant when
        // VITE_FEATURE_AI_ASSISTANT isn't "true") is hidden outright rather
        // than shown disabled: a single-feature group's disabled state is
        // the group-header button itself, which has no dimming style, so it
        // rendered visually identical to an enabled option while silently
        // doing nothing on click.
        .filter((group) => group.matrix || group.features.some((f) => f.available))
        .map((group) => {
        const groupFeatures = group.matrix
          ? group.features
          : group.features.filter(({ available }) => available);
        const availableFeatures = groupFeatures.filter(({ available }) => available);
        const selectedCount = availableFeatures.filter(isFeatureActive).length;
        const allSelected =
          availableFeatures.length > 0 && selectedCount === availableFeatures.length;
        const partiallySelected = selectedCount > 0 && !allSelected;
        const hasOptions = groupFeatures.length > 1;

        return (
          <section
            key={group.id}
            className={`overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-white/12 dark:bg-[#303030]/20 ${
              group.matrix ? 'sm:col-span-2' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              disabled={!availableFeatures.length}
              aria-pressed={allSelected}
              aria-label={`${allSelected ? 'Remove' : 'Add'} all ${group.label} permissions`}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-100 disabled:cursor-not-allowed dark:hover:bg-white/[0.05] ${
                selectedCount ? 'bg-[#15DCFF]/[0.04]' : ''
              } ${
                hasOptions ? 'border-b border-gray-200 dark:border-white/10' : ''
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  selectedCount
                    ? 'border-[#15DCFF] bg-[#15DCFF] text-[#0d0d0f]'
                    : 'border-gray-300 bg-white dark:border-white/20 dark:bg-transparent'
                }`}
              >
                {allSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                {partiallySelected && <Minus className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 text-xs font-semibold">{group.label}</span>
              {hasOptions && (
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-white/[0.07]">
                  {selectedCount}/{availableFeatures.length}
                </span>
              )}
            </button>

            {hasOptions &&
              (group.matrix ? (
                <div className="grid grid-cols-[minmax(72px,1fr)_1fr_1fr] text-[11px]">
                  <div className="px-3 py-1.5 font-medium text-zinc-500">Platform</div>
                  <div className="px-2 py-1.5 text-center font-medium text-zinc-500">Manager</div>
                  <div className="px-2 py-1.5 text-center font-medium text-zinc-500">Autopilot</div>
                  {['Meta', 'Google', 'TikTok'].map((platform) => (
                    <div key={platform} className="contents">
                      <div className="border-t border-gray-200 px-3 py-2 font-medium dark:border-white/10">
                        {platform}
                      </div>
                      {['manager', 'autopilot'].map((mode) => {
                        const feature = group.features.find(
                          (item) => item.platform === platform && item.mode === mode
                        );
                        const active = isFeatureActive(feature);
                        return (
                          <button
                            key={feature.id}
                            type="button"
                            disabled={!feature.available}
                            onClick={() => toggleFeature(feature)}
                            aria-pressed={feature.available ? active : undefined}
                            aria-label={`${platform} ${mode} permission${
                              feature.available ? '' : ' unavailable'
                            }`}
                            className={`flex items-center justify-center border-t border-l border-gray-200 px-2 py-2 transition-colors dark:border-white/10 ${
                              feature.available
                                ? 'hover:bg-[#15DCFF]/[0.06]'
                                : 'cursor-not-allowed text-zinc-400 opacity-50'
                            }`}
                          >
                            {feature.available ? (
                              <span
                                className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                                  active
                                    ? 'border-[#15DCFF] bg-[#15DCFF] text-[#0d0d0f]'
                                    : 'border-gray-300 bg-white dark:border-white/20 dark:bg-transparent'
                                }`}
                              >
                                {active && <Check className="h-3 w-3" strokeWidth={3} />}
                              </span>
                            ) : (
                              <span className="text-[10px]">Soon</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 p-2">
                  {groupFeatures.map((feature) => {
                    const active = isFeatureActive(feature);
                    return (
                      <button
                        key={featureIdsOf(feature).join('+')}
                        type="button"
                        disabled={!feature.available}
                        onClick={() => toggleFeature(feature)}
                        aria-pressed={feature.available ? active : undefined}
                        className={`flex min-h-8 items-center gap-2 rounded-full border px-2.5 py-1.5 text-left text-[11px] font-medium transition-all ${
                          active
                            ? 'border-[#15DCFF]/50 bg-[#15DCFF]/[0.07] text-zinc-950 dark:text-white'
                            : 'border-gray-200 bg-white text-zinc-600 hover:border-gray-300 dark:border-white/[0.08] dark:bg-[#14181D] dark:text-white/70'
                        } ${feature.available ? '' : 'cursor-not-allowed opacity-50'}`}
                      >
                        <span
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                            active
                              ? 'border-[#15DCFF] bg-[#15DCFF] text-[#0d0d0f]'
                              : 'border-gray-300 dark:border-white/20'
                          }`}
                        >
                          {active && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                        </span>
                        {feature.label}
                      </button>
                    );
                  })}
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}

export default function WorkspaceMembersPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [email, setEmail] = useState('');
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await getWorkspaces();
      setData(result);
    } catch (requestError) {
      setError(requestErrorMessage(requestError, 'Unable to load workspace'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const closeDialog = () => {
    if (saving) return;
    setDialog(null);
    setEmail('');
    setSelectedFeatures([]);
  };

  useEffect(() => {
    if (!dialog) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || saving) return;
      setDialog(null);
      setEmail('');
      setSelectedFeatures([]);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog, saving]);

  const openInvite = () => {
    setEmail('');
    setSelectedFeatures([]);
    setDialog({ type: 'invite' });
  };

  const openEdit = (member) => {
    setDialog({ type: 'edit', member });
    setSelectedFeatures(normalizeWorkspaceFeatures(member.features));
  };

  const save = async (event) => {
    event.preventDefault();
    if (!selectedFeatures.length) {
      toast.error('Select at least one feature', { id: 'workspace-management-error' });
      return;
    }

    setSaving(true);
    try {
      if (dialog?.type === 'edit') {
        await updateMemberFeatures(dialog.member.id, selectedFeatures);
        toast.success('Member access updated');
      } else {
        const invitedEmail = email.trim();
        await inviteMember(invitedEmail, selectedFeatures);
        toast.success(`Invitation sent to ${invitedEmail}`);
        GA4Events.workspaceInvitationSent({ source: 'workspace_members_page', success: true });
      }
      setDialog(null);
      setEmail('');
      setSelectedFeatures([]);
      await load();
    } catch (requestError) {
      toast.error(requestErrorMessage(requestError, 'Unable to save workspace access'), {
        id: 'workspace-management-error',
        duration: 5000,
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmDestructiveAction = async () => {
    if (!dialog || !['remove', 'revoke'].includes(dialog.type)) return;

    setSaving(true);
    try {
      if (dialog.type === 'remove') {
        await removeMember(dialog.member.id);
        toast.success('Member removed from the workspace');
      } else {
        await revokeInvitation(dialog.invitation.id);
        toast.success('Invitation revoked');
        GA4Events.workspaceInvitationRevoked({ source: 'workspace_members_page', success: true });
      }
      setDialog(null);
      setEmail('');
      setSelectedFeatures([]);
      await load();
    } catch (requestError) {
      toast.error(
        requestErrorMessage(
          requestError,
          dialog.type === 'remove' ? 'Unable to remove member' : 'Unable to revoke invitation'
        ),
        {
          id: 'workspace-management-error',
          duration: 5000,
        }
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (!data?.canManage) {
    return (
      <div className="mx-auto mt-20 max-w-xl rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-white/[0.06] dark:bg-[#171717]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 dark:border-white/[0.06] dark:bg-white/[0.035]">
          <UserRound className="h-7 w-7 text-[#15DCFF]" />
        </div>
        <h2 className="mt-5 text-xl font-semibold text-zinc-900 dark:text-white">
          Workspace members
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Only paid AdsGPT owners can manage invitations and members.
        </p>
      </div>
    );
  }

  const members = data.members || [];
  const invitations = data.invitations || [];
  const isAccessDialog = dialog?.type === 'invite' || dialog?.type === 'edit';

  return (
    <div className="relative mx-auto w-full max-w-6xl px-5 pt-5 pb-16 text-gray-900 dark:text-white">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-52 w-80 -translate-x-1/2 rounded-full bg-gray-200/50 blur-3xl dark:bg-white/[0.025]" />
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight 2xl:text-2xl">People and access</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-[#BEBEBE]">
            Invite people and choose which AdsGPT features they can use.
          </p>
        </div>
        <button
          type="button"
          onClick={openInvite}
          className="group flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-5 py-2.5 text-xs font-bold text-white shadow-md transition-all hover:opacity-90 2xl:text-sm"
        >
          <Plus className="h-3.5 w-3.5 transition-transform group-hover:rotate-90" />
          Invite people
        </button>
      </div>

      {error && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <span>{error}</span>
          <button
            type="button"
            onClick={load}
            className="shrink-0 font-semibold text-red-400 hover:text-red-300"
          >
            Try again
          </button>
        </div>
      )}

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="relative mt-7 overflow-hidden rounded-2xl border border-gray-200 bg-white backdrop-blur-xl transition-colors hover:border-gray-300 dark:border-white/[0.06] dark:bg-[#0D0D0D]/60 dark:hover:border-white/10"
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-4 dark:border-white/[0.06]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
            <UsersRound className="h-5 w-5 text-[#15DCFF]" />
          </div>
          <div>
            <h3 className="font-semibold">Members</h3>
            <p className="text-xs text-zinc-500">
              {members.length} active {members.length === 1 ? 'member' : 'members'}
            </p>
          </div>
        </div>
        {!members.length ? (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-white/5">
              <UserPlus className="h-5 w-5 text-zinc-500" />
            </div>
            <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              No members yet
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Invite someone to start sharing selected AdsGPT features.
            </p>
          </div>
        ) : (
          members.map((member) => {
            const memberName = member.name || member.email || 'Member';
            const normalizedMemberFeatures = normalizeWorkspaceFeatures(member.features);
            const featureLabels = WORKSPACE_FEATURES.filter((feature) =>
              featureIdsOf(feature).every((id) => normalizedMemberFeatures.includes(id))
            ).map((feature) => feature.label);

            return (
              <div
                key={member.id}
                className="flex flex-wrap items-center gap-4 border-b border-black/5 px-5 py-4 transition-colors last:border-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.025]"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15 text-sm font-bold text-[#15DCFF]">
                  {memberName.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-[180px] flex-1">
                  <p className="truncate text-sm font-medium">{memberName}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{member.email}</p>
                </div>
                <div className="flex max-w-md flex-wrap justify-end gap-1.5">
                  {featureLabels.map((featureLabel) => (
                    <span
                      key={featureLabel}
                      className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-[#BEBEBE]"
                    >
                      {featureLabel}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Edit member access"
                    onClick={() => openEdit(member)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-gray-100 hover:text-zinc-900 dark:hover:bg-white/8 dark:hover:text-white"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove member"
                    onClick={() => setDialog({ type: 'remove', member })}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: 0.04 }}
        className="relative mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white backdrop-blur-xl transition-colors hover:border-gray-300 dark:border-white/[0.06] dark:bg-[#0D0D0D]/60 dark:hover:border-white/10"
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-4 dark:border-white/[0.06]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
            <Clock3 className="h-5 w-5 text-[#15DCFF]" />
          </div>
          <div>
            <h3 className="font-semibold">Pending invitations</h3>
            <p className="text-xs text-zinc-500">Invitations expire after seven days.</p>
          </div>
        </div>
        {!invitations.length ? (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-white/5">
              <Mail className="h-5 w-5 text-zinc-500" />
            </div>
            <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              No pending invitations
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Invitations waiting to be accepted will appear here.
            </p>
          </div>
        ) : (
          invitations.map((invitation) => (
            <div
              key={invitation.id}
              className="flex items-center gap-4 border-b border-black/5 px-5 py-4 transition-colors last:border-0 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.025]"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#15DCFF]/15 to-[#6b72f8]/15">
                <Mail className="h-[18px] w-[18px] text-[#15DCFF]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{invitation.email}</p>
                <p className="mt-0.5 text-xs text-zinc-500">Waiting for acceptance</p>
              </div>
              <button
                type="button"
                onClick={() => setDialog({ type: 'revoke', invitation })}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10"
              >
                Revoke
              </button>
            </div>
          ))
        )}
      </motion.section>

      <AnimatePresence>
        {dialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDialog();
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="workspace-dialog-title"
              className={`relative w-full overflow-hidden border border-gray-200 bg-white text-zinc-950 shadow-2xl shadow-black/30 dark:border-white/10 dark:bg-[#141414] dark:text-white ${
                isAccessDialog
                  ? 'flex max-h-[88vh] max-w-2xl flex-col rounded-2xl'
                  : 'max-w-md rounded-2xl p-6'
              }`}
            >
            {isAccessDialog ? (
              <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-5 py-4 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-[#02C8C4] to-[#5867EB] ring-1 ring-white/10">
                      {dialog.type === 'edit' ? (
                        <ShieldCheck className="h-4.5 w-4.5 text-white" />
                      ) : (
                        <UserPlus className="h-4.5 w-4.5 text-white" />
                      )}
                    </div>
                    <div>
                      <h3 id="workspace-dialog-title" className="text-sm font-bold 2xl:text-base">
                        {dialog.type === 'edit' ? 'Edit member access' : 'Invite a member'}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-[#BEBEBE]">
                        {dialog.type === 'edit'
                          ? dialog.member.email
                          : 'Choose exactly what this person can use.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeDialog}
                    aria-label="Close"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/[0.08] dark:hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">
                  {dialog.type === 'invite' && (
                    <div>
                      <label
                        htmlFor="workspace-invite-email"
                        className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-white/60"
                      >
                        Email address
                      </label>
                      <div className="relative mt-1.5">
                        <Mail className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                        <input
                          id="workspace-invite-email"
                          type="email"
                          required
                          autoFocus
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          placeholder="name@example.com"
                          className="h-9 w-full rounded-xl border border-gray-300 bg-gray-100 pr-3 pl-9 text-xs transition-colors outline-none placeholder:text-zinc-400 focus:border-[#15DCFF]/40 dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:placeholder:text-white/40"
                        />
                      </div>
                      <p className="mt-1.5 text-[10px] leading-4 text-zinc-500 dark:text-white/45">
                        Available for people who do not already have an AdsGPT account.
                      </p>
                    </div>
                  )}

                  <div className={dialog.type === 'invite' ? 'mt-4' : ''}>
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold">Feature access</p>
                        <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-white/45">
                          Nothing is selected automatically.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedFeatures(
                              allAssignableFeatureIds.every((id) => selectedFeatures.includes(id))
                                ? []
                                : allAssignableFeatureIds
                            )
                          }
                          className="text-[10px] font-semibold text-[#15DCFF] hover:underline"
                        >
                          {allAssignableFeatureIds.every((id) => selectedFeatures.includes(id))
                            ? 'Clear all'
                            : 'Select all'}
                        </button>
                        <p className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-medium text-zinc-500 dark:bg-white/[0.06]">
                          {
                            ASSIGNABLE_WORKSPACE_FEATURES.filter((feature) =>
                              featureIdsOf(feature).every((id) => selectedFeatures.includes(id))
                            ).length
                          }{' '}
                          selected
                        </p>
                      </div>
                    </div>
                    {featurePicker(selectedFeatures, setSelectedFeatures)}
                  </div>
                </div>

                <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3.5 dark:border-white/10 dark:bg-white/[0.03]">
                  <button
                    type="button"
                    onClick={closeDialog}
                    disabled={saving}
                    className="rounded-full border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-600 transition-all hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-white/20 dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || (dialog.type === 'invite' && !email.trim())}
                    className="flex min-w-[128px] items-center justify-center rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-5 py-2 text-xs font-bold text-white shadow-md transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : dialog.type === 'edit' ? (
                      'Update access'
                    ) : (
                      'Send invitation'
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10">
                    <Trash2 className="h-5 w-5 text-red-500" />
                  </div>
                  <button
                    type="button"
                    onClick={closeDialog}
                    aria-label="Close"
                    className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/5 dark:hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <h3 id="workspace-dialog-title" className="mt-5 text-xl font-semibold">
                  {dialog.type === 'remove' ? 'Remove workspace member?' : 'Revoke invitation?'}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  {dialog.type === 'remove'
                    ? `${dialog.member.name || dialog.member.email} will immediately lose access to this workspace.`
                    : `The invitation sent to ${dialog.invitation.email} will no longer work.`}
                </p>
                <div className="mt-7 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeDialog}
                    disabled={saving}
                    className="rounded-full border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-semibold text-gray-600 transition-all hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:border-white/20 dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDestructiveAction}
                    disabled={saving}
                    className="flex min-w-32 items-center justify-center rounded-full bg-red-500/85 px-5 py-2 text-xs font-bold text-white transition-all hover:bg-red-500 disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : dialog.type === 'remove' ? (
                      'Remove member'
                    ) : (
                      'Revoke invitation'
                    )}
                  </button>
                </div>
              </div>
            )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
