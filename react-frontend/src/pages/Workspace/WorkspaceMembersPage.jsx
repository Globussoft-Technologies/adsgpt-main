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
    <div className="workspace-feature-picker grid grid-cols-1 items-start gap-2.5 sm:grid-cols-2">
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
            className={`overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#EDE7DF] shadow-xs dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none ${
              group.matrix ? 'sm:col-span-2' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              disabled={!availableFeatures.length}
              aria-pressed={allSelected}
              aria-label={`${allSelected ? 'Remove' : 'Add'} all ${group.label} permissions`}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-[#E5DFD5] disabled:cursor-not-allowed dark:hover:bg-white/[0.05] ${
                selectedCount ? 'bg-[#15DCFF]/[0.08] dark:bg-[#15DCFF]/[0.08]' : ''
              } ${
                hasOptions ? 'border-b border-[#DDD7CD] dark:border-white/10' : ''
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  selectedCount
                    ? 'border-[#15DCFF] bg-[#15DCFF] text-[#0d0d0f]'
                    : 'border-[#DDD7CD] bg-[#FCFAF7] dark:border-white/20 dark:bg-white/[0.06] dark:shadow-none'
                }`}
              >
                {allSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                {partiallySelected && <Minus className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 text-xs font-semibold text-[#24211D] dark:text-white">{group.label}</span>
              {hasOptions && (
                <span className="rounded-full border border-[#DDD7CD] bg-[#FCFAF7] px-2 py-0.5 text-[10px] font-medium text-[#544D44] dark:border-transparent dark:bg-white/[0.07] dark:text-zinc-400">
                  {selectedCount}/{availableFeatures.length}
                </span>
              )}
            </button>

            {hasOptions &&
              (group.matrix ? (
                <div className="grid grid-cols-[minmax(72px,1fr)_1fr_1fr] text-[11px] bg-[#EDE7DF] dark:bg-transparent">
                  <div className="px-3 py-1.5 font-medium text-[#7A7369] dark:text-zinc-400">Platform</div>
                  <div className="px-2 py-1.5 text-center font-medium text-[#7A7369] dark:text-zinc-400">Manager</div>
                  <div className="px-2 py-1.5 text-center font-medium text-[#7A7369] dark:text-zinc-400">Autopilot</div>
                  {['Meta', 'Google', 'TikTok'].map((platform) => (
                    <div key={platform} className="contents">
                      <div className="border-t border-[#DDD7CD] px-3 py-2 font-medium text-[#3D3831] dark:border-white/10 dark:text-white">
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
                            className={`flex items-center justify-center border-t border-l border-[#DDD7CD] px-2 py-2 transition-colors dark:border-white/10 ${
                              feature.available
                                ? 'hover:bg-[#15DCFF]/[0.08] dark:hover:bg-[#15DCFF]/[0.08]'
                                : 'cursor-not-allowed text-[#8C8478] opacity-50 dark:text-zinc-600'
                            }`}
                          >
                            {feature.available ? (
                              <span
                                className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                                  active
                                    ? 'border-[#15DCFF] bg-[#15DCFF] text-[#0d0d0f]'
                                    : 'border-[#DDD7CD] bg-[#FCFAF7] shadow-xs dark:border-white/20 dark:bg-white/[0.06] dark:shadow-none'
                                }`}
                              >
                                {active && <Check className="h-3 w-3" strokeWidth={3} />}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#8C8478] dark:text-zinc-600">Soon</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 p-2 bg-[#EDE7DF] dark:bg-transparent">
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
                            ? 'border-[#15DCFF]/50 bg-[#15DCFF]/[0.10] text-[#24211D] shadow-[inset_1px_1px_2px_rgba(21,220,255,0.20)] dark:text-white dark:shadow-none'
                            : 'border-[#DDD7CD] bg-[#FCFAF7] text-[#3D3831] shadow-[0_1px_2px_rgba(80,70,58,0.04)] hover:bg-[#EAE5DC] hover:text-[#24211D] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:shadow-none dark:hover:bg-white/[0.08] dark:hover:text-white'
                        } ${feature.available ? '' : 'cursor-not-allowed opacity-50'}`}
                      >
                        <span
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                            active
                              ? 'border-[#15DCFF] bg-[#15DCFF] text-[#0d0d0f]'
                              : 'border-[#DDD7CD] bg-white dark:border-white/20 dark:bg-transparent'
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
    <div className="workspace-members-page relative -m-4 min-h-full bg-[#F7F4EE] p-4 text-[#24211D] transition-colors duration-200 sm:p-6 dark:m-0 dark:min-h-0 dark:bg-transparent dark:p-0 dark:text-white">
      <div className="relative mx-auto w-full max-w-6xl pt-2 pb-16">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-52 w-80 -translate-x-1/2 rounded-full bg-[#EADFD0]/25 blur-3xl dark:bg-white/[0.025]" />
        
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#24211D] 2xl:text-2xl dark:text-white">People and access</h2>
            <p className="mt-1 text-sm text-[#7A7369] dark:text-[#BEBEBE]">
              Invite people and choose which AdsGPT features they can use.
            </p>
          </div>
          <button
            type="button"
            onClick={openInvite}
            className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-5 py-2.5 text-xs font-semibold text-white shadow-md transition-all hover:opacity-95 2xl:text-sm"
          >
            <Plus className="h-3.5 w-3.5 text-white transition-transform group-hover:rotate-90" />
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
          className="workspace-members-panel relative mt-7 overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05),0_2px_6px_-1px_rgba(80,70,58,0.03)] backdrop-blur-md dark:border-white/[0.06] dark:bg-[#0D0D0D]/60 dark:shadow-none"
        >
          <div className="flex items-center gap-3 border-b border-[#DDD7CD] bg-[#FAF8F5] px-5 py-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FCFAF7] text-[#24211D] ring-1 ring-[#DDD7CD] dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-white/10">
              <UsersRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-[#24211D] dark:text-white">Members</h3>
              <p className="text-xs text-[#7A7369] dark:text-zinc-500">
                {members.length} active {members.length === 1 ? 'member' : 'members'}
              </p>
            </div>
          </div>
          {!members.length ? (
            <div className="flex flex-col items-center bg-[#FCFAF7] px-5 py-12 text-center dark:bg-transparent">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FCFAF7] text-[#7A7369] ring-1 ring-[#DDD7CD] dark:bg-white/5 dark:text-zinc-500 dark:ring-0">
                <UserPlus className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-[#24211D] dark:text-zinc-300">
                No members yet
              </p>
              <p className="mt-1 text-xs text-[#7A7369] dark:text-zinc-500">
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
                  className="flex flex-wrap items-center gap-4 border-b border-[#DDD7CD] bg-[#FCFAF7] px-5 py-4 transition-colors last:border-0 hover:bg-[#F7F4EE] dark:border-white/5 dark:bg-transparent dark:hover:bg-white/[0.025]"
                >
                  <div className="workspace-member-avatar flex h-9 w-9 items-center justify-center rounded-xl bg-[#F7F4EE] text-sm font-semibold text-[#24211D] ring-1 ring-[#DDD7CD] dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-white/10">
                    {memberName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-[180px] flex-1">
                    <p className="truncate text-sm font-medium text-[#24211D] dark:text-white">{memberName}</p>
                    <p className="mt-0.5 truncate text-xs text-[#7A7369] dark:text-zinc-500">{member.email}</p>
                  </div>
                  <div className="flex max-w-md flex-wrap justify-end gap-1.5">
                    {featureLabels.map((featureLabel) => (
                      <span
                        key={featureLabel}
                        className="workspace-feature-chip rounded-lg border border-[#DDD7CD] bg-[#FCFAF7] px-2.5 py-1 text-[11px] font-medium text-[#3D3831] shadow-[0_1px_2px_rgba(80,70,58,0.04)] dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-[#BEBEBE] dark:shadow-none"
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
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#DDD7CD] bg-[#F7F4EE] text-[#4A443C] shadow-[0_1px_2px_rgba(80,70,58,0.04)] transition-all hover:bg-[#EAE5DC] hover:text-[#24211D] dark:border-transparent dark:bg-transparent dark:text-zinc-500 dark:hover:bg-white/8 dark:hover:text-white"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove member"
                      onClick={() => setDialog({ type: 'remove', member })}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8D0D0] bg-[#F7F4EE] text-[#C93B3B] shadow-[0_1px_2px_rgba(200,60,60,0.05)] transition-all hover:bg-red-50 hover:text-red-600 dark:border-transparent dark:bg-transparent dark:text-zinc-500 dark:hover:bg-red-500/10 dark:hover:text-red-500"
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
          className="workspace-members-panel relative mt-5 overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] shadow-[0_4px_20px_-2px_rgba(80,70,58,0.05),0_2px_6px_-1px_rgba(80,70,58,0.03)] backdrop-blur-md dark:border-white/[0.06] dark:bg-[#0D0D0D]/60 dark:shadow-none"
        >
          <div className="flex items-center gap-3 border-b border-[#DDD7CD] bg-[#FAF8F5] px-5 py-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FCFAF7] text-[#24211D] ring-1 ring-[#DDD7CD] dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-white/10">
              <Clock3 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-[#24211D] dark:text-white">Pending invitations</h3>
              <p className="text-xs text-[#7A7369] dark:text-zinc-500">Invitations expire after seven days.</p>
            </div>
          </div>
          {!invitations.length ? (
            <div className="flex min-h-[188px] flex-col items-center justify-center bg-[#FCFAF7] px-5 py-12 text-center dark:bg-transparent">
              <div className="workspace-empty-icon flex h-10 w-10 items-center justify-center rounded-full bg-[#FCFAF7] text-[#24211D] ring-1 ring-[#DDD7CD] dark:bg-white/5 dark:text-zinc-500 dark:ring-0">
                <Mail className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-[#24211D] dark:text-zinc-300">
                No pending invitations
              </p>
              <p className="mt-1 text-xs text-[#7A7369] dark:text-zinc-500">
                Invitations waiting to be accepted will appear here.
              </p>
            </div>
          ) : (
            invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex items-center gap-4 border-b border-[#DDD7CD] bg-[#FCFAF7] px-5 py-4 transition-colors last:border-0 hover:bg-[#F7F4EE] dark:border-white/5 dark:bg-transparent dark:hover:bg-white/[0.025]"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FCFAF7] text-[#24211D] ring-1 ring-[#DDD7CD] dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-white/10">
                  <Mail className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#24211D] dark:text-white">{invitation.email}</p>
                  <p className="mt-0.5 text-xs text-[#7A7369] dark:text-zinc-500">Waiting for acceptance</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDialog({ type: 'revoke', invitation })}
                  className="rounded-lg border border-red-200 bg-[#F7F4EE] px-3 py-1.5 text-xs font-semibold text-red-600 shadow-[0_1px_2px_rgba(200,60,60,0.05)] transition-colors hover:bg-red-50 dark:border-transparent dark:bg-transparent dark:text-red-500 dark:hover:bg-red-500/10"
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
              className="fixed inset-0 z-[100] flex items-center justify-center bg-[#24211D]/45 p-4 backdrop-blur-sm dark:bg-black/60"
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
                className={`relative w-full overflow-hidden border border-[#DDD7CD] bg-[#F7F4EE] text-[#24211D] shadow-[0_20px_50px_rgba(80,70,58,0.12)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#141414] dark:text-white dark:shadow-2xl dark:shadow-black/40 ${
                  isAccessDialog
                    ? 'flex max-h-[88vh] max-w-2xl flex-col rounded-2xl'
                    : 'max-w-md rounded-2xl p-6'
                }`}
              >
              {isAccessDialog ? (
                <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
                  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#DDD7CD] bg-[#EDE7DF] px-5 py-4 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white shadow-xs dark:ring-1 dark:ring-white/10">
                        {dialog.type === 'edit' ? (
                          <ShieldCheck className="h-4.5 w-4.5 text-white" />
                        ) : (
                          <UserPlus className="h-4.5 w-4.5 text-white" />
                        )}
                      </div>
                      <div>
                        <h3 id="workspace-dialog-title" className="text-sm font-bold 2xl:text-base text-[#24211D] dark:text-white">
                          {dialog.type === 'edit' ? 'Edit member access' : 'Invite a member'}
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-[#7A7369] dark:text-[#BEBEBE]">
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
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[#7A7369] transition-colors hover:bg-[#DDD7CD] hover:text-[#24211D] dark:hover:bg-white/[0.08] dark:hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">
                    {dialog.type === 'invite' && (
                      <div>
                        <label
                          htmlFor="workspace-invite-email"
                          className="text-[11px] font-semibold tracking-wide text-[#7A7369] uppercase dark:text-white/60"
                        >
                          Email address
                        </label>
                        <div className="relative mt-1.5">
                          <Mail className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[#948C80]" />
                          <input
                            id="workspace-invite-email"
                            type="email"
                            required
                            autoFocus
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="name@example.com"
                            className="h-9 w-full rounded-xl border border-[#DDD7CD] bg-[#FCFAF7] pr-3 pl-9 text-xs text-[#24211D] transition-colors outline-none placeholder:text-[#948C80] shadow-[inset_0_1px_2px_rgba(80,70,58,0.03)] focus:border-[#02C8C4] focus:ring-2 focus:ring-[#02C8C4]/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:placeholder:text-white/40 dark:shadow-none dark:focus:border-[#15DCFF]/60"
                          />
                        </div>
                        <p className="mt-1.5 text-[10px] leading-4 text-[#7A7369] dark:text-white/45">
                          Available for people who do not already have an AdsGPT account.
                        </p>
                      </div>
                    )}

                    <div className={dialog.type === 'invite' ? 'mt-4' : ''}>
                      <div className="mb-2 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-[#24211D] dark:text-white">Feature access</p>
                          <p className="mt-0.5 text-[10px] text-[#7A7369] dark:text-white/45">
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
                            className="workspace-select-all text-[10px] font-semibold text-[#02A8A4] hover:underline"
                          >
                            {allAssignableFeatureIds.every((id) => selectedFeatures.includes(id))
                              ? 'Clear all'
                              : 'Select all'}
                          </button>
                          <p className="workspace-selection-count rounded-full border border-[#DDD7CD] bg-[#EDE7DF] px-2 py-1 text-[10px] font-medium text-[#544D44] dark:border-transparent dark:bg-white/[0.06] dark:text-zinc-400">
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

                  <div className="flex shrink-0 justify-end gap-2 border-t border-[#DDD7CD] bg-[#EDE7DF] px-5 py-3.5 dark:border-white/10 dark:bg-white/[0.03]">
                    <button
                      type="button"
                      onClick={closeDialog}
                      disabled={saving}
                      className="rounded-full border border-[#DDD7CD] bg-[#FCFAF7] px-4 py-2 text-xs font-semibold text-[#4A443C] shadow-[0_1px_3px_rgba(80,70,58,0.06)] transition-all hover:bg-[#EAE5DC] hover:text-[#24211D] disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:shadow-none dark:hover:bg-white/[0.08] dark:hover:border-white/20 dark:hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving || (dialog.type === 'invite' && !email.trim())}
                      className="workspace-primary-action flex min-w-[128px] items-center justify-center rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-5 py-2 text-xs font-semibold text-white shadow-md transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
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
                      className="rounded-lg p-2 text-[#7A7369] transition-colors hover:bg-[#DDD7CD] hover:text-[#24211D] dark:hover:bg-white/5 dark:hover:text-white"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <h3 id="workspace-dialog-title" className="mt-5 text-xl font-semibold text-[#24211D] dark:text-white">
                    {dialog.type === 'remove' ? 'Remove workspace member?' : 'Revoke invitation?'}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[#7A7369] dark:text-zinc-500">
                    {dialog.type === 'remove'
                      ? `${dialog.member.name || dialog.member.email} will immediately lose access to this workspace.`
                      : `The invitation sent to ${dialog.invitation.email} will no longer work.`}
                  </p>
                  <div className="mt-7 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={closeDialog}
                      disabled={saving}
                      className="rounded-full border border-[#DDD7CD] bg-[#FCFAF7] px-4 py-2 text-xs font-semibold text-[#4A443C] shadow-[0_1px_3px_rgba(80,70,58,0.06)] transition-all hover:bg-[#EAE5DC] hover:text-[#24211D] disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:shadow-none dark:hover:bg-white/[0.08] dark:hover:border-white/20 dark:hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmDestructiveAction}
                      disabled={saving}
                      className="flex min-w-32 items-center justify-center rounded-full bg-red-500 px-5 py-2 text-xs font-bold text-white shadow-[0_4px_14px_rgba(239,68,68,0.25)] transition-all hover:bg-red-600 disabled:opacity-50"
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
    </div>
  );
}
