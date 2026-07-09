import ChatInterface from '@/components/AIAssistant/ChatInterface';
import AIAssistantBg from '@/components/AIAssistant/AIAssistantBg';

const AIAssistantPage = () => (
  <div className="font-universal flex min-h-0 w-full flex-1 flex-col">
    {/* Ambient animated backdrop (gradient blobs, swaying aurora, stars, glass
        tiles) — all compositor-only motion; see AIAssistantBg. */}
    <AIAssistantBg />
    <ChatInterface />
  </div>
);

export default AIAssistantPage;
