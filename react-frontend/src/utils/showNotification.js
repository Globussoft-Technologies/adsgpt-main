import NotifyLogo from '@/assets/layouts/adsgpt-dark-mode-logo.svg';
import {
  setAdsDialogOpen,
  setAdsDialogType,
} from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  setAdCreativeSessionId,
  setAdVideoSessionId,
} from '@/store/reducers/adStudio/adHistorySlice';
import { setActivePage, setMySpaceTab } from '@/store/reducers/adStudio/adVideoNewSlice';
import { setActiveAdStudioTab } from '@/store/reducers/adStudio/adStudioTabsSlice';
import {
  setActiveBrandIQTab,
  setSelectedCompetitorBrand,
} from '@/store/reducers/brandIQ/brandIQTabsSlice';
import router from '@/routes/router';

export const showNotification = (sessionId, type, dispatch) => {
  let lastSessionID = sessionId ? sessionId : '';

  if (typeof window.Notification === 'undefined') {
    console.warn('This browser does not support notifications.');
    return;
  }

  let notificationPermission;
  try {
    notificationPermission = Notification.permission;
  } catch (err) {
    console.warn('Notification API not available:', err);
    return;
  }

  if (notificationPermission === 'granted') {
    createNotification(lastSessionID, type, dispatch);
    return;
  }
  if (notificationPermission === 'denied') {
    console.error('Notifications were previously denied');
    return;
  }

  Notification.requestPermission()
    .then((permission) => {
      notificationPermission = permission;
      if (permission === 'granted') {
        createNotification(lastSessionID, type, dispatch);
      } else {
        console.error('Notification permission not granted');
      }
    })
    .catch((err) => {
      console.error('Error requesting notification permission:', err);
    });
};

function createNotification(newsession, type, dispatch) {
  let notification;
  try {
    if (type === 'video') {
      notification = new Notification('Video Generation Complete!', {
        body: 'Hi! Your requested video has been generated. Click to view it.',
        icon: NotifyLogo,
        vibrate: [100, 50, 100],
        requireInteraction: false,
        tag: `video-gen-${Date.now()}`,
        silent: false,
      });
    } else {
      notification = new Notification('Image Generation Complete!', {
        body: 'Hi! Your requested image has been generated. Click to view it.',
        icon: NotifyLogo,
        vibrate: [100, 50, 100],
        requireInteraction: false,
        tag: `image-gen-${Date.now()}`,
        silent: false,
      });
    }

    notification.onclick = (event) => {
      event.preventDefault();
      router.navigate('/adstudio');
      if (type === 'video') {
        // dispatch(setActiveAdStudioTab('adVideo'));
        dispatch(setAdVideoSessionId(newsession));
      } else {
        // dispatch(setActiveAdStudioTab('adCreative'));
        dispatch(setAdCreativeSessionId(newsession));
      }
      window.focus();
      notification.close();
    };

    notification.onerror = (err) => {
      console.error('Notification error:', err);
    };
  } catch (error) {
    console.error('Notification creation failed:', error);
  }
}

// Add at the top of your notification file
let currentNotification = null;
let lastRequestId = null;

export const showNotificationforadfactory = (type, dispatch, campaignId) => {
  // Generate a unique request ID based on type and timestamp
  const requestId = `${type}-${Date.now()}`;

  // If we're already processing the same request, skip it
  if (lastRequestId === requestId) {
    return;
  }

  lastRequestId = requestId;

  // Clear any existing notification
  if (currentNotification) {
    currentNotification.close();
    currentNotification = null;
  }

  Notification.requestPermission()
    .then((permission) => {
      if (permission === 'granted') {
        // Wait a bit to ensure any previous notification is cleared
        setTimeout(() => {
          createNotificationforadfactory(type, dispatch, requestId, campaignId);
        }, 100);
      } else {
        console.error('Notification permission not granted');
      }
    })
    .catch((err) => {
      console.error('Error requesting notification permission:', err);
    });
};

function createNotificationforadfactory(type, dispatch, requestId, campaignId) {
  // If this is not the latest request, skip it
  if (lastRequestId !== requestId) {
    return;
  }

  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      // This is a hack to close all notifications
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      iframe.contentWindow.close();
      document.body.removeChild(iframe);
    }
  } catch (e) {
    // Ignore errors from the hack
  }

  try {
    const uniqueTag = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    let notification;
    if (type === 'text') {
      notification = new Notification('Text Generation Complete!', {
        body: 'Hi! Your requested Text has been generated. Click to view it.',
        icon: NotifyLogo,
        vibrate: [100, 50, 100],
        requireInteraction: false,
        tag: uniqueTag,
        silent: false,
      });
    } else {
      notification = new Notification('Image Generation Complete!', {
        body: 'Hi! Your requested image has been generated. Click to view it.',
        icon: NotifyLogo,
        vibrate: [100, 50, 100],
        requireInteraction: false,
        tag: uniqueTag,
        silent: false,
      });
    }

    // Store the current notification
    currentNotification?.push(notification);

    notification.onclick = (event) => {
      event.preventDefault();

      const currentUrl = new URL(window.location.href);
      const isOnAdFactory = currentUrl.pathname.includes('/adfactory');
      const urlCampaignId = currentUrl.searchParams.get('campaignId');

      if (campaignId) {
        if (!isOnAdFactory || urlCampaignId !== campaignId) {
          router.navigate(`/adfactory?campaignId=${campaignId}`);
        }
      } else if (!isOnAdFactory) {
        router.navigate('/adfactory');
      }

      if (type === 'text') {
        dispatch(setAdsDialogType('text'));
        dispatch(setAdsDialogOpen(true));
      } else {
        dispatch(setAdsDialogType('image'));
        dispatch(setAdsDialogOpen(true));
      }
      window.focus();
      notification.close();
      currentNotification = null;
    };

    // Clear request ID after a while
    setTimeout(() => {
      if (lastRequestId === requestId) {
        lastRequestId = null;
      }
    }, 5000);
  } catch (error) {
    console.error('Notification creation failed:', error);
    currentNotification = null;
  }
}

let lastMyVideoRequestId = null;

export const showNotificationForMyVideo = (dispatch) => {
  if (typeof window.Notification === 'undefined') return;

  // Generate a unique request ID so rapid calls don't stack
  const requestId = `my-video-${Date.now()}`;
  lastMyVideoRequestId = requestId;

  Notification.requestPermission()
    .then((permission) => {
      if (permission === 'granted') {
        setTimeout(() => {
          createNotificationForMyVideo(dispatch, requestId);
        }, 100);
      } else {
        console.error('Notification permission not granted');
      }
    })
    .catch((err) => {
      console.error('Error requesting notification permission:', err);
    });
};

function createNotificationForMyVideo(dispatch, requestId) {
  // If a newer call came in, skip this one
  if (lastMyVideoRequestId !== requestId) return;

  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      // Flush any stale notifications (same iframe trick as adfactory)
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        iframe.contentWindow.close();
        document.body.removeChild(iframe);
      } catch (e) {
        // ignore
      }
    }

    // Unique tag prevents browser from silently deduplicating notifications
    const uniqueTag = `my-video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const notification = new Notification('Video Generation Complete!', {
      body: 'Hi! Your requested video has been generated. Click to view it in My Space.',
      icon: NotifyLogo,
      vibrate: [100, 50, 100],
      requireInteraction: false,
      tag: uniqueTag,
      silent: false,
    });

    notification.onerror = (err) => {
      console.error('Notification error:', err);
    };

    notification.onclick = (event) => {
      event.preventDefault();
      router.navigate('/adstudio');
      dispatch(setActiveAdStudioTab('adVideoNew'));
      dispatch(setMySpaceTab('videos'));
      dispatch(setActivePage('myVideos'));
      window.focus();
      notification.close();
    };

    // Reset request ID after a while
    setTimeout(() => {
      if (lastMyVideoRequestId === requestId) {
        lastMyVideoRequestId = null;
      }
    }, 5000);
  } catch (error) {
    console.error('Notification creation failed for My Video:', error);
  }
}

// Image-equivalent of showNotificationForMyVideo — used by socket's
// `imageCreated` listener so AdCreative generations don't fire a "video"
// toast. Clicking routes to MySpace > Images.
let lastMyImageRequestId = null;

export const showNotificationForMyImage = (dispatch) => {
  if (typeof window.Notification === 'undefined') return;

  const requestId = `my-image-${Date.now()}`;
  lastMyImageRequestId = requestId;

  Notification.requestPermission()
    .then((permission) => {
      if (permission === 'granted') {
        setTimeout(() => {
          createNotificationForMyImage(dispatch, requestId);
        }, 100);
      } else {
        console.error('Notification permission not granted');
      }
    })
    .catch((err) => {
      console.error('Error requesting notification permission:', err);
    });
};

function createNotificationForMyImage(dispatch, requestId) {
  if (lastMyImageRequestId !== requestId) return;

  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        iframe.contentWindow.close();
        document.body.removeChild(iframe);
      } catch (e) {
        // ignore
      }
    }

    const uniqueTag = `my-image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const notification = new Notification('Image Generation Complete!', {
      body: 'Hi! Your requested image has been generated. Click to view it in My Space.',
      icon: NotifyLogo,
      vibrate: [100, 50, 100],
      requireInteraction: false,
      tag: uniqueTag,
      silent: false,
    });

    notification.onerror = (err) => {
      console.error('Notification error:', err);
    };

    notification.onclick = (event) => {
      event.preventDefault();
      router.navigate('/adstudio');
      dispatch(setActiveAdStudioTab('adVideoNew'));
      // MySpace shares the page key with videos but selects the Images tab.
      dispatch(setMySpaceTab('images'));
      dispatch(setActivePage('myVideos'));
      window.focus();
      notification.close();
    };

    setTimeout(() => {
      if (lastMyImageRequestId === requestId) {
        lastMyImageRequestId = null;
      }
    }, 5000);
  } catch (error) {
    console.error('Notification creation failed for My Image:', error);
  }
}

let lastCompetitorAdsRequestId = null;

export const showCompetitorAdsReadyNotification = (brand, dispatch) => {
  if (typeof window.Notification === 'undefined') return;

  const requestId = `competitor-ads-${brand?.id}-${Date.now()}`;
  lastCompetitorAdsRequestId = requestId;

  Notification.requestPermission()
    .then((permission) => {
      if (permission === 'granted') {
        setTimeout(() => {
          createCompetitorAdsNotification(brand, dispatch, requestId);
        }, 100);
      }
    })
    .catch((err) => {
      console.error('Error requesting notification permission:', err);
    });
};

function createCompetitorAdsNotification(brand, dispatch, requestId) {
  if (lastCompetitorAdsRequestId !== requestId) return;

  try {
    const uniqueTag = `competitor-ads-${brand?.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const brandName = brand?.name || brand?.brandName || 'your brand';

    const notification = new Notification('Competitor Ads Ready!', {
      body: `You can check your competitor ads for ${brandName}.`,
      icon: NotifyLogo,
      vibrate: [100, 50, 100],
      requireInteraction: false,
      tag: uniqueTag,
      silent: false,
    });

    notification.onclick = (event) => {
      event.preventDefault();
      router.navigate('/brandiq');
      dispatch(setActiveBrandIQTab('competitors'));
      dispatch(setSelectedCompetitorBrand(brand));
      window.focus();
      notification.close();
    };

    notification.onerror = (err) => {
      console.error('Competitor ads notification error:', err);
    };

    setTimeout(() => {
      if (lastCompetitorAdsRequestId === requestId) {
        lastCompetitorAdsRequestId = null;
      }
    }, 5000);
  } catch (error) {
    console.error('Competitor ads notification creation failed:', error);
  }
}

export const showFailureNotification = (type, reason = 'generation failed') => {
  if (typeof window.Notification === 'undefined') return;

  Notification.requestPermission().then((permission) => {
    if (permission === 'granted') {
      let bodyText = `Hi! Your requested ${type} could not be generated.`;
      if (reason === 'planExpired' || reason === 'insufficientCredits') {
        bodyText = `Hi! Your plan has expired or you have insufficient credits. ${type} couldn't be generated.`;
      }

      const title = `${type.charAt(0).toUpperCase() + type.slice(1)} Generation Failed`;

      const notification = new Notification(title, {
        body: bodyText,
        icon: NotifyLogo,
        vibrate: [100, 50, 100],
        requireInteraction: false,
        tag: `fail-${type}-${Date.now()}`,
        silent: false,
      });

      notification.onclick = (event) => {
        event.preventDefault();
        window.focus();
        notification.close();
      };
    }
  });
};
