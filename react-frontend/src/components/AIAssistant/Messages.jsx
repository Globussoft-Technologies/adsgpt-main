import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion } from 'framer-motion';
import StepsIndicator from './StepsIndicator';
import MessageActions from './MessageActions';
import CompetitorAdsGrid from './CompetitorAdsGrid';
import VideoStoryboard from './VideoStoryboard';
import AdCreativePackage from './AdCreativePackage';
import ChoiceForm from './ChoiceForm';

const isVideoUrl = (url) => /\.(mp4|webm|mov)(\?|$)/i.test(url || '');

const MediaGrid = ({ urls = [] }) => {
  if (!urls.length) return null;
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {urls.map((url) =>
        isVideoUrl(url) ? (
          <video
            key={url}
            src={url}
            controls
            className="w-full rounded-xl border border-white/10 bg-black"
          />
        ) : (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-xl border border-white/10 bg-black/40"
          >
            <img src={url} alt="Generated" className="h-full w-full object-cover" loading="lazy" />
          </a>
        ),
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
}) => {
  const endRef = useRef(null);
  const sessionId = useSelector((state) => state.aiAssistant.sessionId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending, pendingActiveLabel, pendingDoneLabels]);

  return (
    <div className="flex w-full flex-col gap-6 text-white">
      {messages.map((m) => {
        if (m.role === 'user') {
          return (
            <div key={m.id} className="group flex flex-col items-end">
              <div className="ml-12 max-w-3xl">
                <div
                  className="border border-solid border-[#2A2A2A] bg-[#212121] px-5 py-3.5 text-[17px] leading-relaxed backdrop-blur-[100px] 2xl:text-[18px]"
                  style={{ borderRadius: '30px 30px 1px 30px' }}
                >
                  {m.text}
                </div>
                {m.attachments?.length > 0 && (
                  <div className="mt-1 flex flex-wrap justify-end gap-1.5">
                    {m.attachments.map((a, i) => {
                      const url = typeof a === 'string' ? a : a.url;
                      const label = typeof a === 'string' ? a : a.filename || a.file_type;
                      return (
                        <a
                          key={`${url}-${i}`}
                          href={url}
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
                <div className="prose prose-invert prose-lg max-w-none break-words [&_p]:my-2 [&_p]:text-[17px] [&_p]:leading-relaxed [&_li]:text-[17px] [&_h1]:text-[24px] [&_h2]:text-[21px] [&_h3]:text-[19px] [&_code]:text-[15px]">
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                </div>
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

              <MediaGrid urls={m.images || []} />

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
                  />
                </div>
              )}
            </div>
          </motion.div>
        );
      })}

      <div ref={endRef} />
    </div>
  );
};

export default Messages;
