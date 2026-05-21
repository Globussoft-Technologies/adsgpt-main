import React from 'react';
import addieIcon from '@/assets/layouts/addie-chats/addie.svg';
import { useDispatch } from 'react-redux';
import { toggleAddieChatVisibility } from '@/store/reducers/adInsights/Addie/AddieChatBotSlice';

const ChatBotButton = () => {
  const dispatch = useDispatch();

  return (
    <div id="tour_addie_open_section" className="chat_bot_addie_container fixed right-4 bottom-4">
      <button
        onClick={() => dispatch(toggleAddieChatVisibility())}
        className="flex scale-100 cursor-pointer items-center justify-center rounded-[50px_50px_5px_50px] bg-gradient-to-tr from-white/10 via-white/60 to-white/10 p-0.5 transition-all duration-200 ease-out hover:scale-105 xl:scale-[0.8] 2xl:scale-100 2xl:hover:scale-110"
      >
        <div className="flex h-full w-full items-center justify-center rounded-[50px_50px_5px_50px] bg-gradient-to-br from-[#222222] to-[#5771F6] p-2.5">
          <img src={addieIcon} alt="Addie" className="h-12 w-12" />
        </div>
      </button>
    </div>
  );
};

export default ChatBotButton;
