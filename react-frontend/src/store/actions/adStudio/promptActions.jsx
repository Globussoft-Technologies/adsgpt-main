import axios from 'axios';
import { setField } from '@/store/reducers/adStudio/promptSlice';
import getCookies from '@/utils/getCookies';
import { toast } from 'react-toastify';
import { fetchModelCredits } from '@/utils/fetchModelCredits';

const PROMPT_API = import.meta.env.VITE_PROMPT_API;

/**
 * Thunk to get prompt suggestions from the Gemini API
 */
export const suggestPrompt = () => async (dispatch, getState) => {
  const { prompt: promptState, socket, adStudioTabs } = getState();
  const currentPrompt = promptState?.prompt;
  const user_id = socket?.userData?.user_id;
  const activeTab = adStudioTabs?.activeAdStudioTabId;

  if (!currentPrompt || !currentPrompt.trim()) return;

  dispatch(setField({ key: 'isSuggestingPrompt', value: true }));

  try {
    const type = activeTab === 'adCopy' ? 'copy' : activeTab === 'adCreative' ? 'image' : 'video';
    const token = getCookies();

    const response = await axios.post(
      `${PROMPT_API}`,
      {
        user_id,
        prompt: currentPrompt,
        type,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.data && response.data.suggested_prompt) {
      // Store the suggested prompt but don't apply it yet
      const suggestedPrompt = response.data.suggested_prompt;

      // Wait for 2 seconds as requested after response is received
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 1. Store the original prompt
      dispatch(setField({ key: 'originalPrompt', value: currentPrompt }));
      // 2. Store the improved prompt
      dispatch(setField({ key: 'improvedPrompt', value: suggestedPrompt }));
      // 3. Set the current prompt to the improved one
      dispatch(setField({ key: 'prompt', value: suggestedPrompt }));
      // 4. Mark that we are using the improved prompt
      dispatch(setField({ key: 'isUsingImprovedPrompt', value: true }));
    }
  } catch (error) {
    toast.error('prompt must contain at least 3 words');
    console.error('Error suggesting prompt:', error);
  } finally {
    dispatch(setField({ key: 'isSuggestingPrompt', value: false }));
  }
};

export const fetchModelCreditsAction = () => async (dispatch) => {
  try {
    const data = await fetchModelCredits();
    if (data) {
      dispatch(setField({ key: 'modelCredits', value: data }));
    }
  } catch (error) {
    console.error('Error fetching model credits:', error);
  }
};
