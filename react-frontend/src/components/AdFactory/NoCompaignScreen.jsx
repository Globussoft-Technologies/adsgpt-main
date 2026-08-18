import { Plus, Loader, Trash2, Edit2, Pencil, X, Check } from 'lucide-react';
import React, { useEffect, useState, useRef } from 'react';
import StartFormDialog from './NodeForms/StartForm';
import AdFactoryBgEffect from './NodeForms/AdFactoryBgEffect';
import { useDispatch, useSelector } from 'react-redux';
import {
  deleteAdFactoryCampaign,
  fetchCampaignById,
  fetchCampaigns,
  updateCampaign,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { useNavigate } from 'react-router-dom';
import { resetNodeStatuses, setActiveForm } from '@/store/reducers/AdFactory/AdFactorySlice';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { ShadcnTooltip } from '../layout/ShadcnTooltip';
import {
  setAvailablefirstImages,
  setDeleteDialogOpen,
  setFirstAdCopies,
  updateAdCreatives,
} from '@/store/reducers/adFactoryNew/adFactoryNewSlice';

const DescriptionWithShowMore = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const description = text || 'No description provided';
  const limit = 130;
  const isLongText = description.length > limit;

  const displayedText = !expanded && isLongText ? description.slice(0, limit) + '...' : description;

  return (
    <div
      className="text-sm leading-[1.4] break-words text-[#3E4A5E] transition-all duration-300 dark:text-[#BEBEBE]"
      style={{ wordBreak: 'break-word' }}
    >
      {displayedText}
      {isLongText && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="ml-1 cursor-pointer font-semibold text-[#1F2937] hover:underline dark:text-white"
        >
          {expanded ? 'Show Less' : 'Show More'}
        </span>
      )}
    </div>
  );
};

const NoCompaignScreen = () => {
  const [openStartForm, setOpenStartForm] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState(null);
  const [campaignToEdit, setCampaignToEdit] = useState(null);
  const [editedCampaignName, setEditedCampaignName] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitialCampaignFetch, setIsInitialCampaignFetch] = useState(false);

  const { campaigns, deleteCampaignId, deleteDialogOpen, loading } = useSelector(
    (state) => state.adFactoryNew
  );
  const { userData } = useSelector((state) => state.socket);
  const userId = userData?.user_id;
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const campaignsList = campaigns?.data || [];
  const showCampaignLoader =
    (!userId && campaignsList.length === 0) || loading || isInitialCampaignFetch;

  const handleCampaignClick = (campaign) => {
    const CampainId = campaign?.metadata?.campaignId;
    const payload = {
      campaignId: CampainId,
      userId: userData?.user_id,
    };
    dispatch(
      updateAdCreatives([
        {
          id: '1',
          name: 'Ad Creative 1',
          image: '',
          text: [],
          cta: '',
          ctaLink: null,
          createdAt: '',
        },
      ])
    );
    dispatch(setAvailablefirstImages([]));
    dispatch(setFirstAdCopies([]));
    dispatch(resetNodeStatuses());
    dispatch(setActiveForm(null));
    dispatch(fetchCampaignById(payload));
    navigate(`/adfactory?campaignId=${CampainId}`);
  };

  const handleDeleteClick = (e, campaign) => {
    e.stopPropagation();
    setCampaignToDelete(campaign);
    dispatch(setDeleteDialogOpen(true));
  };

  const handleEditClick = (e, campaign) => {
    e.stopPropagation();
    setCampaignToEdit(campaign);
    setEditedCampaignName(campaign?.metadata?.campaignName || '');
    setEditDialogOpen(true);
  };

  const handleEditDialogOpenAutoFocus = (event) => {
    event.preventDefault();

    const input = inputRef.current;
    if (!input) return;

    input.focus();
    const caretPosition = input.value.length;
    input.setSelectionRange(caretPosition, caretPosition);
  };

  const handleSaveEdit = async () => {
    if (!campaignToEdit || !editedCampaignName.trim()) return;

    const originalName = campaignToEdit?.metadata?.campaignName || '';
    const newName = editedCampaignName.trim();

    if (newName === originalName) {
      setEditDialogOpen(false);
      setCampaignToEdit(null);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        campaignId: campaignToEdit?.metadata?.campaignId,
        userId: userData?.user_id,
        nodeType: 'metadata',
        data: {
          campaignName: newName,
        },
      };

      await dispatch(updateCampaign(payload));

      // Refresh campaigns list after update
      dispatch(fetchCampaigns(userData?.user_id));

      setEditDialogOpen(false);
      setCampaignToEdit(null);
    } catch (error) {
      console.error('Failed to update campaign name:', error);
      // Optionally show a toast notification here
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = () => {
    if (campaignToDelete) {
      dispatch(
        deleteAdFactoryCampaign({
          campaignId: campaignToDelete?.metadata?.campaignId,
          userId: userData?.user_id,
        })
      );

      // setCampaignToDelete(null);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isSubmitting) {
      e.preventDefault();
      handleSaveEdit();
    }
  };

  // Reset form when dialog closes
  useEffect(() => {
    if (!editDialogOpen) {
      setEditedCampaignName('');
      setIsSubmitting(false);
    }
  }, [editDialogOpen]);

  useEffect(() => {
    if (!userId) return undefined;

    let isMounted = true;
    setIsInitialCampaignFetch(true);

    Promise.resolve(dispatch(fetchCampaigns(userId))).finally(() => {
      if (isMounted) setIsInitialCampaignFetch(false);
    });

    return () => {
      isMounted = false;
    };
  }, [dispatch, userId]);

  return (
    <>
      <div className="brands_new_container relative z-10 flex w-full flex-col sm:p-6">
        {!loading && campaignsList?.length > 0 && (
          <div id="new_campaign_button" className="mb-4 flex shrink-0 justify-end">
            <div className="group w-fit rounded-full bg-gradient-to-b from-black/15 to-black/5 p-[1px] dark:from-white/40 dark:to-white/10">
              <button
                onClick={() => setOpenStartForm(true)}
                className="adfactory-new-campaign-button backdrop-blur-100 relative flex h-10 items-center justify-center gap-1.5 rounded-full bg-white px-5 py-1.5 text-base text-gray-600 transition-all duration-300 hover:text-black dark:bg-[#0D0D0D]/60 dark:text-[#AFAFAF] dark:hover:text-white"
              >
                <Plus className="h-4 w-4 text-[#6b72f8] transition-all group-hover:text-black/70 2xl:h-5 2xl:w-5 dark:group-hover:text-white/70" />
                <span className="bg-gradient-to-t from-[#0c9fbd] to-[#5057d6] bg-clip-text font-medium text-transparent group-hover:text-black/70 dark:from-[#15DCFF] dark:to-[#6b72f8] dark:group-hover:text-white/70">
                  New Campaign
                </span>
              </button>
            </div>
          </div>
        )}
        {/* Show loader when loading */}
        {showCampaignLoader ? (
          <div className="flex min-h-[55vh] w-full items-center justify-center">
            <Loader className="h-8 w-8 animate-spin text-gray-600" />
          </div>
        ) : campaignsList?.length === 0 ? (
          /* Empty State */
          <div className="flex min-h-[70vh] w-full items-center justify-center">
            <div className="flex flex-col items-center justify-center space-y-5 p-6 text-center">
              <h2 className="text-xl font-medium text-gray-700 dark:text-[#AFAFAF]">
                No Ad Campaigns yet
              </h2>
              <p className="max-w-sm text-base text-gray-500 dark:text-[#AFAFAF]">
                You haven't launched any Ad campaigns yet. Start one to reach your audience.
              </p>
              <div className="group mt-1 w-fit rounded-full bg-gradient-to-b from-black/15 to-black/5 p-[1px] dark:from-white/40 dark:to-white/10">
                <button
                  onClick={() => setOpenStartForm(true)}
                  className="backdrop-blur-100 relative flex h-10 items-center justify-center gap-1.5 rounded-full bg-white px-5 py-1.5 text-base text-gray-600 transition-all duration-300 hover:text-black dark:bg-[#0D0D0D]/60 dark:text-[#AFAFAF] dark:hover:text-white"
                >
                  <Plus className="h-4 w-4 text-[#6b72f8] transition-all group-hover:text-black/70 2xl:h-5 2xl:w-5 dark:group-hover:text-white/70" />
                  <span className="bg-gradient-to-t from-[#0c9fbd] to-[#5057d6] bg-clip-text font-medium text-transparent group-hover:text-black/70 dark:from-[#15DCFF] dark:to-[#6b72f8] dark:group-hover:text-white/70">
                    Start New Campaign
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full max-h-[calc(100svh-152px)] overflow-y-auto px-1 pt-2 pb-4 sm:max-h-[calc(100svh-196px)] 2xl:max-h-[calc(100svh-216px)]">
            <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {campaignsList?.map((campaign) => (
                <div
                  key={campaign?.id}
                  onClick={() => handleCampaignClick(campaign)}
                  className="ad-factory-campaign-card group relative isolate flex h-full w-full cursor-pointer flex-col gap-4 overflow-hidden rounded-[18px] border border-[#DDD7CD] bg-[#FAF8F5] p-5 py-6 shadow-[0_4px_20px_-2px_rgba(80,70,58,0.06),0_2px_6px_-1px_rgba(80,70,58,0.03)] backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#C8C1B4] hover:shadow-[0_8px_24px_rgba(80,70,58,0.10)] dark:border-white/15 dark:bg-[#121214] dark:shadow-[0_4px_24px_rgba(0,0,0,0.5),0_0_15px_rgba(21,220,255,0.06)] dark:hover:border-[#15DCFF]/50 dark:hover:shadow-[0_0_30px_rgba(21,220,255,0.2),0_0_12px_rgba(107,114,248,0.25)]"
                >
                  {/* Ambient corner glow on hover */}
                  <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-gradient-to-br from-[#15DCFF] to-[#6b72f8] opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-15 dark:group-hover:opacity-25" />

                  {/* Header: name + date */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {campaign?.metadata?.campaignName?.length > 20 && (
                        <ShadcnTooltip
                          label={
                            campaign?.metadata?.campaignName?.length > 20 &&
                            campaign?.metadata?.campaignName
                          }
                        >
                          <h2 className="line-clamp-2 break-all text-[17px] font-semibold leading-snug text-[#24211D] dark:text-white">
                            {campaign?.metadata?.campaignName || 'Untitled Campaign'}
                          </h2>
                        </ShadcnTooltip>
                      )}
                      <h2 className="line-clamp-2 break-all text-[17px] font-semibold leading-snug text-[#24211D] dark:text-white">
                        {campaign?.metadata?.campaignName?.length < 21 &&
                          campaign?.metadata?.campaignName}
                      </h2>
                    </div>
                    <span className="ml-2 shrink-0 text-[12px] font-medium text-[#7A7369] dark:text-[#8B8B8B]">
                      {campaign?.updatedAt &&
                        new Date(campaign?.updatedAt)?.toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                    </span>
                  </div>

                  {/* Description */}
                  <DescriptionWithShowMore text={campaign?.brandInfo?.brandDescription} />

                  {/* Footer: status badge + action buttons */}
                  <div className="flex items-center justify-between">
                    {/* Active / Inactive pill */}
                    <button
                      className="adfactory-campaign-status flex items-center justify-center rounded-full border border-[#DDD7CD] bg-white px-5 py-1 text-[13px] font-medium shadow-[0_1px_3px_rgba(80,70,58,0.04)] transition-all duration-200 hover:bg-[#F7F4EE] dark:border-[#15DCFF]/30 dark:bg-[#15DCFF]/10 dark:shadow-[0_0_12px_rgba(21,220,255,0.15)] dark:hover:bg-[#15DCFF]/20"
                    >
                      <span className="bg-gradient-to-t from-[#0c9fbd] to-[#5057d6] bg-clip-text font-semibold text-transparent dark:from-[#15DCFF] dark:to-[#6b72f8]">
                        {campaign?.status === 'success' || campaign?.status === 'edit-in-progress'
                          ? 'Active'
                          : 'Inactive'}
                      </span>
                    </button>

                    {/* Icon buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => handleEditClick(e, campaign)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#DDD7CD] bg-white text-[#7A7369] shadow-[0_1px_3px_rgba(80,70,58,0.04)] transition-colors hover:bg-[#F7F4EE] hover:text-[#278A31] dark:border-white/10 dark:bg-[#1A1A1A] dark:text-gray-400 dark:shadow-none dark:hover:text-[#72ff6b]"
                        title="Edit campaign name"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteClick(e, campaign)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#DDD7CD] bg-white text-[#7A7369] shadow-[0_1px_3px_rgba(80,70,58,0.04)] transition-colors hover:bg-[#F7F4EE] hover:text-[#D94C4C] dark:border-white/10 dark:bg-[#1A1A1A] dark:text-gray-400 dark:shadow-none dark:hover:bg-[#2A2A2A] dark:hover:text-[#FF6B6B]"
                        title="Delete campaign"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Edit Campaign Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent
          onOpenAutoFocus={handleEditDialogOpenAutoFocus}
          className="light-glass-dialog adfactory-campaign-dialog flex w-full !max-w-[420px] flex-col overflow-x-hidden rounded-[24px] border border-[#DDD7CD] bg-[#FAF8F5] p-6 shadow-2xl backdrop-blur-xl sm:p-8 dark:border-white/10 dark:bg-[#181818] dark:shadow-2xl dark:shadow-black/40"
        >
          <div className="mb-4 flex items-center justify-between">
            <DialogTitle className="text-xl font-semibold text-[#24211D] dark:text-white">
              Edit Campaign Name
            </DialogTitle>
          </div>

          <div className="space-y-6">
            <div className="space-y-3">
              <label
                htmlFor="campaign-name"
                className="text-sm font-medium text-[#7A7369] dark:text-[#CCCCCC]"
              >
                Campaign Name
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  id="campaign-name"
                  type="text"
                  value={editedCampaignName}
                  onChange={(e) => setEditedCampaignName(e.target.value)}
                  onKeyDown={handleKeyPress}
                  className="adfactory-campaign-dialog-input w-full rounded-xl border border-[#DDD7CD] bg-white px-4 py-3.5 text-[#24211D] shadow-xs placeholder:text-[#948C80] focus:border-[#02C8C4] focus:outline-none dark:border-white/10 dark:bg-[#242424] dark:text-white dark:shadow-none"
                  placeholder="Enter campaign name"
                  disabled={isSubmitting}
                  maxLength={50}
                />
                <div className="absolute top-1/2 right-3 -translate-y-1/2">
                  <Pencil className="h-4 w-4 text-[#7A7369] dark:text-gray-400" />
                </div>
              </div>
              <p className="text-xs text-[#7A7369] dark:text-gray-400">{editedCampaignName.length}/50 characters</p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4">
              <button
                onClick={() => setEditDialogOpen(false)}
                disabled={isSubmitting}
                className="adfactory-campaign-dialog-secondary rounded-xl border border-[#DDD7CD] bg-white px-6 py-2.5 text-sm font-medium text-[#24211D] shadow-xs transition-all hover:bg-[#F7F4EE] disabled:opacity-50 dark:border-white/10 dark:bg-[#282828] dark:text-gray-200 dark:shadow-none dark:hover:bg-[#333333] dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editedCampaignName.trim() || isSubmitting}
                className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-[#6b72f8] to-[#15DCFF] px-6 py-2.5 text-sm font-medium text-white transition-all hover:from-[#7b82ff] hover:to-[#25ECFF] hover:shadow-lg hover:shadow-[#6b72f8]/20 disabled:opacity-50"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Save Changes
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent
          className="light-glass-dialog adfactory-campaign-dialog flex w-full !max-w-[380px] flex-col overflow-x-hidden rounded-[24px] border border-[#DDD7CD] bg-[#FAF8F5] p-6 shadow-2xl backdrop-blur-xl sm:p-8 dark:border-white/10 dark:bg-[#181818]"
          showCloseButton={false}
        >
          <div className="mb-4 flex flex-col items-center justify-center space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-red-500/20 to-red-600/20">
              <Trash2 className="h-7 w-7 text-red-500" />
            </div>
            <DialogTitle className="text-center text-xl font-semibold text-[#24211D] dark:text-white">
              Delete Campaign?
            </DialogTitle>
          </div>

          <DialogDescription className="text-center text-[#7A7369] dark:text-[#CCCCCC]">
            <p>
              Are you sure you want to delete "
              <span className="font-semibold text-[#24211D] dark:text-white">
                {campaignToDelete?.metadata?.campaignName || 'Untitled Campaign'}
              </span>
              "? This action cannot be undone.
            </p>
          </DialogDescription>

          <div className="flex w-full flex-col items-center justify-center space-y-4 pt-6">
            <div className="flex w-full items-center justify-center gap-3">
              <button
                onClick={() => {
                  dispatch(setDeleteDialogOpen(false));
                  setCampaignToDelete(null);
                }}
                className="adfactory-campaign-dialog-secondary flex-1 rounded-xl border border-[#DDD7CD] bg-white px-6 py-2.5 text-sm font-medium text-[#24211D] transition-all hover:bg-[#F7F4EE] dark:border-transparent dark:bg-[#2A2A2A] dark:text-gray-300 dark:hover:bg-[#3A3A3A] dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-6 py-2.5 text-sm font-medium text-white transition-all hover:from-red-700 hover:to-red-800 hover:shadow-lg hover:shadow-red-500/20"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deleting...
                  </span>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
            <p className="text-sm text-gray-500">Campaign data will be permanently removed</p>
          </div>
        </DialogContent>
      </Dialog>

      <StartFormDialog open={openStartForm} onOpenChange={setOpenStartForm} />
      <AdFactoryBgEffect />
    </>
  );
};

export default NoCompaignScreen;
