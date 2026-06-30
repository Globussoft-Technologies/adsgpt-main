import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Bot, Quote, ArrowRight, Download } from 'lucide-react';
import { setMySpaceTab, setMySpaceImageSource } from '@/store/reducers/adStudio/adVideoNewSlice';
import ReactMarkdown from 'react-markdown';
import { motion } from 'framer-motion';
import StepsIndicator from './StepsIndicator';
import MessageActions from './MessageActions';
import CompetitorAdsGrid from './CompetitorAdsGrid';
import VideoStoryboard from './VideoStoryboard';
import AdCreativePackage from './AdCreativePackage';
import ChoiceForm from './ChoiceForm';
import QuotableText from './QuotableText';
import ImageLightbox from './ImageLightbox';
import toMediaUrl from '@/utils/mediaUrl';
import { handleDownload } from '@/utils/download';

const isVideoUrl = (url) => /\.(mp4|webm|mov)(\?|$)/i.test(url || '');

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i;

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
      <div className="rounded-lg border-l-2 border-white/40 bg-white/[0.04] px-3 py-1.5">
        <div className="flex items-center gap-1 text-[10px] font-medium tracking-wide text-white/70 uppercase">
          <Quote className="h-2.5 w-2.5" />
          {quote.role === 'assistant' ? 'Replying to assistant' : quote.role === 'user' ? 'Replying to you' : 'Replying to'}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-white/55">{quote.text}</div>
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
  if (!urls.length) return null;

  const total = urls.length;
  const visible = urls.slice(0, MEDIA_GRID_LIMIT);
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
          const src = toMediaUrl(url);
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
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDownload(src); }}
                  title="Download"
                  className="absolute top-1.5 right-1.5 hidden h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/85 backdrop-blur transition-colors hover:bg-black/80 hover:text-white group-hover:flex"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
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
  onQuote,
}) => {
  const endRef = useRef(null);
  const sessionId = useSelector((state) => state.aiAssistant.sessionId);
  const [lightboxSrc, setLightboxSrc] = useState(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending, pendingActiveLabel, pendingDoneLabels]);

  return (
    <div className="flex w-full flex-col gap-6 text-white">
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className="group flex flex-col items-end">
              <QuotedBlock quote={m.quote} align="right" />
              <div className="ml-12 min-w-0 max-w-3xl">
                <div
                  className="border border-solid border-[#2A2A2A] bg-[#212121] px-5 py-3.5 text-[17px] leading-relaxed break-words backdrop-blur-[100px] 2xl:text-[18px]"
                  style={{ borderRadius: '30px 30px 1px 30px' }}
                >
                  <QuotableText onQuote={(text) => onQuote?.({ text, role: 'user', messageId: m.id })}>
                    {m.text}
                  </QuotableText>
                </div>
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
            <div className="min-w-0 max-w-3xl flex-1">
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

              {m.text ? (
                <QuotableText
                  onQuote={(text) => onQuote?.({ text, role: 'assistant', messageId: m.id })}
                  className="prose prose-invert prose-lg max-w-none break-words [&_p]:my-2 [&_p]:text-[17px] [&_p]:leading-relaxed [&_li]:text-[17px] [&_h1]:text-[24px] [&_h2]:text-[21px] [&_h3]:text-[19px] [&_code]:text-[15px] [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_a]:break-words [&_img]:max-w-full [&_table]:block [&_table]:overflow-x-auto"
                >
                  <ReactMarkdown
                    components={{
                      img: ({ node, src, ...props }) => (
                        <img src={toMediaUrl(src)} loading="lazy" {...props} />
                      ),
                      a: ({ node, href, ...props }) => (
                        <a href={toMediaUrl(href)} target="_blank" rel="noreferrer" {...props} />
                      ),
                    }}
                  >
                    {m.text}
                  </ReactMarkdown>
                </QuotableText>
              ) : (
                showLiveSteps &&
                !pendingActiveLabel?.length && (
                  <div className="flex animate-pulse flex-col gap-2 py-1">
                    <div className="h-3.5 w-4/5 rounded-full bg-white/10" />
                    <div className="h-3.5 w-3/5 rounded-full bg-white/10" />
                    <div className="h-3.5 w-2/5 rounded-full bg-white/10" />
                  </div>
                )
              )}

              <MediaGrid urls={m.images || []} onOpenImage={setLightboxSrc} />

              <CompetitorAdsGrid ads={m.competitorAds || []} />

              {m.adCreative &&
                Array.isArray(m.adCreative.variants) &&
                m.adCreative.variants.length > 0 && (
                  <AdCreativePackage pack={m.adCreative} />
                )}

              {m.choiceForm && (
                <ChoiceForm
                  form={m.choiceForm}
                  messageId={m.id}
                  result={m.choiceFormResult}
                  onSubmit={onChoiceFormSubmit}
                  disabled={pending && isLast}
                />
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
