import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Bot, Quote, ArrowRight, PanelRightOpen, Sparkles, Check } from 'lucide-react';
import { setMySpaceTab, setMySpaceImageSource } from '@/store/reducers/adStudio/adVideoNewSlice';
import ReactMarkdown from 'react-markdown';
import { motion } from 'framer-motion';
import StepsIndicator from './StepsIndicator';
import MessageActions from './MessageActions';
import CompetitorAdsGrid from './CompetitorAdsGrid';
import VideoStoryboard from './VideoStoryboard';
import ConceptCards from './ConceptCards';
import AdCreativePackage from './AdCreativePackage';
import DownloadMenu from './DownloadMenu';
import QuotableText from './QuotableText';
import ImageLightbox from './ImageLightbox';
import MetaConnectCard from './MetaConnectCard';
import CardBlock from '@/components/MetaAds/Chatbot/cards/CardBlock';
import ConfirmActionCard from '@/components/MetaAds/Chatbot/ConfirmActionCard';
import MediaPickerCard from '@/components/MetaAds/Chatbot/MediaPickerCard';
import { uploadFile } from '@/apis/aiAssistant/aiAssistantApi';
import toMediaUrl from '@/utils/mediaUrl';

const isVideoUrl = (url) => /\.(mp4|webm|mov)(\?|$)/i.test(url || '');
const normalizeAccountId = (value) => String(value || '').replace(/^act_/, '');

const findMetaActionCurrency = (messages, pendingAction) => {
  const targetId = (pendingAction?.actions || [])
    .map((action) =>
      normalizeAccountId(
        action.args?.account_id || action.args?.ad_account_id || action.args?.act_id,
      ),
    )
    .find(Boolean);
  if (!targetId) return undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const cards = messages[index]?.metaCards || [];
    for (const card of cards) {
      if (card.kind !== 'account_picker') continue;
      const account = (card.accounts || []).find(
        (item) => normalizeAccountId(item.id || item.accountId) === targetId,
      );
      if (account?.currency) return account.currency;
    }
  }
  return undefined;
};

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i;
// Keep this as a normal SPA path. react-markdown sanitizes custom URI schemes
// before custom renderers receive them, which previously turned adsgpt:// into
// an empty href (current page in a new tab) and bypassed MetaConnectCard.
const META_CONNECT_LINK = '/ads-manager?connect=meta';
const META_OAUTH_RESUME_KEY = 'aia1_meta_oauth_resume';

const isMetaConnectLink = (href) => {
  if (!href?.startsWith('/ads-manager')) return false;
  try {
    return new URL(href, window.location.origin).searchParams.get('connect') === 'meta';
  } catch {
    return false;
  }
};

// A chat attachment is an image when its file_type or URL/filename says so.
// Attachments arrive as a string URL, or { url, filename, file_type }.
const isImageAttachment = (a) => {
  if (!a) return false;
  if (typeof a === 'string') return IMAGE_EXT_RE.test(a);
  const ft = (a.file_type || '').toLowerCase();
  if (/(png|jpe?g|gif|webp|bmp|svg)/.test(ft)) return true;
  return IMAGE_EXT_RE.test(a.url || '') || IMAGE_EXT_RE.test(a.filename || '');
};

// Small "replying to …" block shown above a message that carries a quote.
const QuotedBlock = ({ quote, align = 'left' }) => {
  if (!quote?.text) return null;
  return (
    <div className={`mb-1.5 max-w-3xl ${align === 'right' ? 'ml-12 self-end' : ''}`}>
      <div className="rounded-lg border-l-2 border-gray-400 bg-black/[0.04] px-3 py-1.5 dark:border-white/40 dark:bg-white/[0.04]">
        <div className="flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase text-gray-600 dark:text-white/70">
          <Quote className="h-2.5 w-2.5" />
          {quote.role === 'assistant'
            ? 'Replying to assistant'
            : quote.role === 'user'
              ? 'Replying to you'
              : 'Replying to'}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-gray-700 dark:text-white/55">
          {quote.text}
        </div>
      </div>
    </div>
  );
};

// How many thumbnails we render inline before collapsing the rest behind a
// "View more" affordance that jumps to My Space (the user's media library).
const MEDIA_GRID_LIMIT = 6;

// Column count adapts to how many images there are, so the grid stays compact
// and square instead of stretching into one tall column:
//   1 → single (capped width)   2 / 4 → 2-up   3 and 5+ → 3-up
const gridColsClass = (n) => {
  if (n <= 1) return 'grid-cols-1 max-w-[260px]';
  if (n === 2 || n === 4) return 'grid-cols-2';
  return 'grid-cols-3';
};

const MediaGrid = ({ urls = [], onOpenImage }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  // Under rapid/continuous generation a freshly-generated image URL can 404
  // briefly (S3 path not yet propagated). Retry once with a cache-bust before
  // giving up, and hide the tile entirely if it still fails — so the user never
  // sees a permanent broken-image box (bug: broken images on continuous prompts).
  const [attempts, setAttempts] = useState({});
  const [dead, setDead] = useState(() => new Set());

  const onImgError = (url) => {
    setAttempts((prev) => {
      const n = (prev[url] || 0) + 1;
      if (n > 1) setDead((d) => new Set(d).add(url));
      return { ...prev, [url]: n };
    });
  };

  if (!urls.length) return null;

  // Also drop empty/whitespace URLs — an <img src=""> renders a broken box that
  // never fires onError, so it would never make it into `dead` (BUG 8).
  const live = urls.filter((u) => u && String(u).trim() && (isVideoUrl(u) || !dead.has(u)));
  if (!live.length) return null;

  const total = live.length;
  const visible = live.slice(0, MEDIA_GRID_LIMIT);
  const overflow = total - visible.length;

  // Open My Space → Images → AI Assistant source (where these chat-generated
  // images live). MySpace lives inside /adstudio and both its active tab and
  // image source are redux-driven, so set them before routing.
  const openMySpace = () => {
    dispatch(setMySpaceTab('images'));
    dispatch(setMySpaceImageSource('aiAssistant'));
    navigate('/adstudio');
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className={`grid gap-2 ${gridColsClass(visible.length)}`}>
        {visible.map((url, i) => {
          const base = toMediaUrl(url);
          const retry = attempts[url] || 0;
          const src =
            retry && typeof base === 'string'
              ? `${base}${base.includes('?') ? '&' : '?'}r=${retry}`
              : base;
          const isOverflowTile = overflow > 0 && i === visible.length - 1;
          if (isVideoUrl(url)) {
            return (
              <video
                key={url}
                src={src}
                controls
                className="aspect-square w-full rounded-xl border border-white/10 bg-black object-cover"
              />
            );
          }
          return (
            <div
              key={url}
              className="group relative block aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/40"
            >
              <button
                type="button"
                onClick={() => (isOverflowTile ? openMySpace() : onOpenImage?.(url))}
                className="block h-full w-full"
              >
                <img
                  src={src}
                  alt="Generated"
                  loading="lazy"
                  onError={() => onImgError(url)}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                />
                {isOverflowTile && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/65 text-white backdrop-blur-[2px]">
                    <span className="text-[18px] font-semibold">+{overflow}</span>
                    <span className="text-[11px] text-white/80">View more</span>
                  </div>
                )}
              </button>
              {!isOverflowTile && (
                // Keep the trigger laid out (opacity, not `hidden`) so Radix can
                // measure its position — a display:none trigger makes the dropdown
                // jump to the top-left corner when the menu opens / hover is lost.
                <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
                  <DownloadMenu url={src} variant="icon" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {overflow > 0 && (
        <button
          type="button"
          onClick={openMySpace}
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11.5px] font-medium text-white/70 transition-colors hover:border-white/25 hover:text-white"
        >
          View all {total} in My Space
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

const Messages = ({
  messages = [],
  pending,
  pendingActiveLabel,
  pendingDoneLabels,
  completedLabel,
  onChoiceFormSubmit,
  onConceptSelect,
  onOpenCanvas,
  onQuote,
  onRecreate,
  onMetaAction,
  onMetaConfirm,
  onMetaCancel,
  onMetaMediaPick,
  onMetaMediaCancel,
}) => {
  const endRef = useRef(null);
  const navigate = useNavigate();
  const sessionId = useSelector((state) => state.aiAssistant.sessionId);
  const [lightboxSrc, setLightboxSrc] = useState(null);

  // Assistant-authored product links stay inside the SPA. Meta connection is
  // intentionally handed off to Ads Manager so its established account checks
  // and OAuth flow remain the single source of truth.
  const handleAssistantLink = (event, href) => {
    if (isMetaConnectLink(href)) {
      event.preventDefault();
      try {
        sessionStorage.setItem(META_OAUTH_RESUME_KEY, JSON.stringify({ sessionId }));
      } catch {
        /* The route still works when storage is unavailable. */
      }
      const returnTo = '/assistant?meta_connected=1';
      navigate(`${META_CONNECT_LINK}&returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    if (href?.startsWith('/')) {
      event.preventDefault();
      navigate(href);
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending, pendingActiveLabel, pendingDoneLabels]);

  return (
    <div className="flex w-full flex-col gap-6 text-zinc-900 dark:text-white">
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className="group flex flex-col items-end">
              <QuotedBlock quote={m.quote} align="right" />
              <div className="ml-12 max-w-3xl min-w-0">
                {/* Only render the text bubble when there's actual text — a
                    message with just an attachment (image upload) must not show
                    an empty grey bubble. */}
                {m.text?.trim() && (
                  <div
                    className="border border-solid border-black/10 bg-white/80 text-zinc-900 shadow-xs backdrop-blur-md dark:border-[#2A2A2A] dark:bg-[#212121]/60 dark:text-white px-5 py-3.5 text-[17px] leading-relaxed break-words 2xl:text-[18px]"
                    style={{ borderRadius: '30px 30px 1px 30px' }}
                  >
                    <QuotableText
                      onQuote={(text) => onQuote?.({ text, role: 'user', messageId: m.id })}
                    >
                      {m.text}
                    </QuotableText>
                  </div>
                )}
                {m.attachments?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                    {m.attachments.map((a, i) => {
                      const url = typeof a === 'string' ? a : a.url;
                      const label = typeof a === 'string' ? a : a.filename || a.file_type || 'file';
                      if (isImageAttachment(a)) {
                        return (
                          <button
                            key={`${url}-${i}`}
                            type="button"
                            onClick={() => setLightboxSrc(url)}
                            title={label}
                            className="h-20 w-20 overflow-hidden rounded-xl border border-white/10 bg-black/40"
                          >
                            <img
                              src={toMediaUrl(url)}
                              alt={label}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          </button>
                        );
                      }
                      return (
                        <a
                          key={`${url}-${i}`}
                          href={toMediaUrl(url)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-white/10 bg-[#1B1B1B] px-2 py-0.5 text-[10px] text-white/70 hover:text-white"
                        >
                          {label}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="mt-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                <MessageActions
                  messageId={m.id}
                  conversationId={sessionId}
                  role="user"
                  text={m.text}
                  onReply={() => onQuote?.({ text: m.text, role: 'user', messageId: m.id })}
                />
              </div>
            </div>
          );
        }

        // assistant
        const isLast = m === messages[messages.length - 1];
        const showLiveSteps = isLast && pending;
        const isStreaming = isLast && pending;
        return (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="group flex gap-3"
          >
            <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#15DCFF] to-[#5E66F5]">
              <Bot className="h-4 w-4 text-black" />
            </div>
            <div className="max-w-3xl min-w-0 flex-1">
              {showLiveSteps && (
                <StepsIndicator
                  doneLabels={pendingDoneLabels}
                  activeLabel={pendingActiveLabel}
                  completedLabel={null}
                />
              )}
              {!showLiveSteps && m.steps?.length > 0 && (
                <StepsIndicator
                  doneLabels={m.steps}
                  activeLabel={null}
                  completedLabel={isLast ? completedLabel : null}
                />
              )}

              {Array.isArray(m.metaCards) && m.metaCards.length > 0 && (
                <div className="mb-3 flex flex-col gap-3">
                  {m.metaCards.map((card, index) => (
                    <CardBlock
                      key={`${card.kind || 'meta-card'}-${index}`}
                      card={card}
                      onAction={onMetaAction}
                      disabled={pending && isLast}
                    />
                  ))}
                </div>
              )}

              {m.metaPendingAction?.status === 'pending' && (
                <div className="mb-3">
                  <ConfirmActionCard
                    actions={m.metaPendingAction.actions || []}
                    busy={pending}
                    currency={findMetaActionCurrency(messages, m.metaPendingAction)}
                    onConfirm={() => onMetaConfirm?.(m.metaPendingAction)}
                    onCancel={() => onMetaCancel?.(m.metaPendingAction)}
                  />
                </div>
              )}

              {m.metaPendingAction?.status &&
                m.metaPendingAction.status !== 'pending' && (
                  <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/60">
                    {m.metaPendingAction.status === 'executed'
                      ? 'Meta Ads action approved and completed.'
                      : m.metaPendingAction.status === 'declined'
                        ? 'Meta Ads action cancelled. Nothing changed.'
                        : 'The approved Meta Ads action did not complete.'}
                  </div>
                )}

              {m.metaMediaPicker?.status === 'pending' && (
                <div className="mb-3">
                  <MediaPickerCard
                    mediaType={m.metaMediaPicker.mediaType}
                    purpose={m.metaMediaPicker.purpose}
                    busy={pending}
                    uploadMedia={uploadFile}
                    onSubmit={(url, mediaType) =>
                      onMetaMediaPick?.(m.metaMediaPicker, url, mediaType)
                    }
                    onCancel={() => onMetaMediaCancel?.(m.metaMediaPicker)}
                  />
                </div>
              )}

              {m.text ? (
                <QuotableText
                  onQuote={(text) => onQuote?.({ text, role: 'assistant', messageId: m.id })}
                  className="prose dark:prose-invert prose-lg max-w-none text-zinc-900 dark:text-white break-words [&_a]:break-words [&_code]:text-[15px] [&_code]:break-words [&_h1]:text-[24px] [&_h2]:text-[21px] [&_h3]:text-[19px] [&_img]:max-w-full [&_li]:text-[17px] [&_p]:my-2 [&_p]:text-[17px] [&_p]:leading-relaxed [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:break-words [&_pre]:whitespace-pre-wrap [&_table]:block [&_table]:overflow-x-auto"
                >
                  <ReactMarkdown
                    components={{
                      img: ({ node, src, ...props }) => (
                        <img src={toMediaUrl(src)} loading="lazy" {...props} />
                      ),
                      a: ({ node, href, ...props }) => {
                        if (isMetaConnectLink(href)) {
                          return (
                            <MetaConnectCard
                              onClick={(event) => handleAssistantLink(event, href)}
                            />
                          );
                        }
                        const internal = href?.startsWith('/');
                        return (
                          <a
                            href={internal ? href : toMediaUrl(href)}
                            onClick={(event) => handleAssistantLink(event, href)}
                            target={internal ? undefined : '_blank'}
                            rel={internal ? undefined : 'noreferrer'}
                            {...props}
                          />
                        );
                      },
                    }}
                  >
                    {m.text}
                  </ReactMarkdown>
                </QuotableText>
              ) : (
                showLiveSteps &&
                !pendingActiveLabel?.length && (
                  <div className="flex animate-pulse flex-col gap-2 py-1">
                    <div className="h-3.5 w-4/5 rounded-full bg-gray-200 dark:bg-white/10" />
                    <div className="h-3.5 w-3/5 rounded-full bg-gray-200 dark:bg-white/10" />
                    <div className="h-3.5 w-2/5 rounded-full bg-gray-200 dark:bg-white/10" />
                  </div>
                )
              )}

              {m.adCreative && (
                <AdCreativePackage
                  pack={m.adCreative}
                  onPrepare={(workspaceId) =>
                    onMetaAction?.(
                      `Prepare ad workspace ${workspaceId} for Meta posting. Check that every selected creative has complete copy and ask me only for missing posting details.`,
                    )
                  }
                />
              )}

              <MediaGrid
                urls={m.adCreative ? [] : m.images || []}
                onOpenImage={setLightboxSrc}
              />

              <CompetitorAdsGrid ads={m.competitorAds || []} onRecreate={onRecreate} />

              {m.conceptCards && Array.isArray(m.conceptCards.concepts) && (
                <ConceptCards
                  cards={m.conceptCards}
                  messageId={m.id}
                  result={m.conceptResult}
                  onSelect={onConceptSelect}
                  // Any generation in flight, not just one on THIS message:
                  // handleConceptSelect refuses to start a second turn while
                  // pending, so concepts on earlier messages looked clickable
                  // and then swallowed the click.
                  disabled={pending}
                />
              )}

              {/* Creative brief (genCard) — opens in the right-side canvas. */}
              {m.choiceForm && (
                <button
                  type="button"
                  onClick={() => onOpenCanvas?.(m.id)}
                  className="mt-3 flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-[#0F0F0F] px-4 py-3 text-left transition-colors hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#15DCFF]/20 to-[#5E66F5]/20">
                    <Sparkles className="h-4 w-4 text-[#15DCFF]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-white/90">
                      {m.choiceForm.title || 'Creative brief'}
                    </span>
                    <span className="block text-[11.5px] text-white/50">
                      {m.choiceFormResult ? (
                        <span className="inline-flex items-center gap-1">
                          <Check className="h-3 w-3" /> Submitted — reopen to edit &amp; regenerate
                        </span>
                      ) : (
                        'Open to review and generate'
                      )}
                    </span>
                  </span>
                  <PanelRightOpen className="h-4 w-4 shrink-0 text-white/45" />
                </button>
              )}

              {m.storyboard && Array.isArray(m.storyboard.scenes) && (
                <VideoStoryboard storyboard={m.storyboard} messageId={m.id} />
              )}

              {!isStreaming && m.text && (
                <div className="mt-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                  <MessageActions
                    messageId={m.id}
                    conversationId={sessionId}
                    role="assistant"
                    text={m.text}
                    feedback={m.feedback}
                    onReply={() => onQuote?.({ text: m.text, role: 'assistant', messageId: m.id })}
                  />
                </div>
              )}
            </div>
          </motion.div>
        );
      })}

      <div ref={endRef} />

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
};

export default Messages;
