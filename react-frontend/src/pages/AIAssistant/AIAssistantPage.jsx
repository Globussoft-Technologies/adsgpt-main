import ChatInterface from '@/components/AIAssistant/ChatInterface';
import AIAssistantBgEffect from '@/components/AIAssistant/AIAssistantBgEffect';
import CursorGlow from '@/components/AIAssistant/CursorGlow';

const AIAssistantPage = () => (
  <div className="font-universal flex min-h-0 w-full flex-1 flex-col">
    {/* Same layers/colors as Ad Factory's background (over the app's #0f0f0f
        body base), but this AI-Assistant-only variant animates the gradient. */}
    <AIAssistantBgEffect />
    <ChatInterface />
    <CursorGlow />
  </div>
);

export default AIAssistantPage;
