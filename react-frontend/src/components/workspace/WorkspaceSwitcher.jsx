import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Layers3, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getWorkspaces, switchWorkspace } from '@/apis/workspaces/workspaceApi';
import {
  firstAllowedPath,
  isWorkspacePathAllowed,
  isWorkspaceMember,
  sessionPayload,
  setWorkspaceToken,
} from '@/utils/workspaceSession';

function activateWorkspaceSession(result) {
  setWorkspaceToken(result.token);
  const currentPath = window.location.pathname;
  const allowedPath = firstAllowedPath(result.features);
  const currentFeatureAllowed = isWorkspacePathAllowed(currentPath, result.features);
  window.location.assign(currentFeatureAllowed ? currentPath : allowedPath);
}

export default function WorkspaceSwitcher() {
  const payload = sessionPayload();
  const memberSession = isWorkspaceMember(payload);
  const currentId = String(payload.workspace_id || '');
  const [workspaces, setWorkspaces] = useState([]);
  const [loadingId, setLoadingId] = useState('');
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const loaded = useRef(false);

  useEffect(() => {
    if (!memberSession || loaded.current) return;
    loaded.current = true;
    getWorkspaces()
      .then(async (result) => {
        const choices = result.workspaces || [];
        setWorkspaces(choices);
        const latest = choices.find((workspace) => workspace.id === currentId);
        if (!latest) return;
        const tokenFeatures = [...(payload.workspace_features || [])].sort();
        const latestFeatures = [...(latest.features || [])].sort();
        if (JSON.stringify(tokenFeatures) !== JSON.stringify(latestFeatures)) {
          setLoadingId(currentId);
          activateWorkspaceSession(await switchWorkspace(currentId));
        }
      })
      .catch(() => {
        setLoadingId('');
        toast.error('Unable to load workspaces', { id: 'workspace-switcher-error' });
      })
      .finally(() => {
        setLoadingWorkspaces(false);
      });
  }, [memberSession]);

  if (!memberSession) return null;

  const current = workspaces.find((workspace) => workspace.id === currentId) || {
    id: currentId,
    name: payload.workspace_name || 'Shared workspace',
    features: payload.workspace_features || [],
  };

  const selectWorkspace = async (workspace) => {
    if (loadingId) return;
    setLoadingId(workspace.id);
    try {
      const result = await switchWorkspace(workspace.id);
      activateWorkspaceSession(result);
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'Unable to switch workspace', {
        id: 'workspace-switcher-error',
      });
      setLoadingId('');
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 max-w-64 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-900 transition-all hover:border-gray-300 dark:border-white/[0.06] dark:bg-[#171717] dark:text-white dark:hover:border-white/10"
        >
          <Layers3 className="h-4 w-4 shrink-0 text-cyan-500" />
          <span className="truncate">{current.name}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 rounded-2xl border-gray-200 bg-white p-2 text-zinc-900 shadow-2xl dark:border-white/[0.08] dark:bg-[#171717] dark:text-white"
      >
        <p className="px-2 py-1 text-[10px] font-semibold tracking-[0.18em] text-zinc-500 uppercase">
          Switch workspace
        </p>
        <div className="mt-1 space-y-1">
          {loadingWorkspaces ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-[#15DCFF]" />
            </div>
          ) : (
            workspaces.map((workspace) => {
              const active = workspace.id === currentId;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => selectWorkspace(workspace)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? 'border-gray-200 bg-gray-50 dark:border-white/[0.06] dark:bg-white/[0.04]'
                      : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.035]'
                  }`}
                >
                  <Layers3 className="h-4 w-4 shrink-0 text-cyan-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{workspace.name}</p>
                    <p className="text-[10px] text-zinc-500">Shared with you</p>
                  </div>
                  {loadingId === workspace.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : active ? (
                    <Check className="h-4 w-4 text-cyan-500" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
