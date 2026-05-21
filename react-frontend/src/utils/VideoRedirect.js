const HOST = import.meta.env.VITE_SOCKET_URL;
const VITE_APP_PROJECT_VIDEO_EDITOR = import.meta.env.VITE_APP_PROJECT_VIDEO_EDITOR;

export async function saveVideoAndRedirect(videoUrl) {
  try {
    const response = await fetch(`${HOST}/adsgpt/prompt/video/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoUrl }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.key) {
      // Redirect to editor with key
      window.open(`${VITE_APP_PROJECT_VIDEO_EDITOR}/editor/${data.key}`, '_blank');
    } else {
      throw new Error('Invalid API response');
    }
  } catch (error) {
    console.error('Failed to save video:', error);
  }
}
