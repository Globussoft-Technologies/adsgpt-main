import ChatInterface from '@/components/AIAssistant/ChatInterface';
import AdFactoryBgEffect from '@/components/AdFactory/NodeForms/AdFactoryBgEffect';

const AIAssistantPage = () => (
  <div className="font-universal flex min-h-0 w-full flex-1 flex-col">
    {/* Exact same background effect Ad Factory uses (over the app's #0f0f0f
        body base) — one consistent background, no custom overlay. */}
    <AdFactoryBgEffect />
    <ChatInterface />
  </div>
);

export default AIAssistantPage;
