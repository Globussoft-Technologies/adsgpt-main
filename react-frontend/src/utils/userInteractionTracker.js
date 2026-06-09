import getCookies from '@/utils/getCookies';
import { useSelector } from 'react-redux';
let token = getCookies();
let hoverTimeout = null;
let lastHoveredElement = null;
let lastInteractions = null;
let lastSessionID =
  JSON.parse(sessionStorage.getItem('cookieInteraction'))?.clicks['chat_session_ID'] || null;
let currentSessionID = sessionStorage.getItem('chatSessionId');
let pageRedirectId = null;
let pageEnterTime = null;

const interactions = {
  clicks: {},
  hovers: {},
  copies: {},
  scrolls: {},
  adCopySide: [],
  adCreativeSide: [],
  pageLocation: {},
  chat_session_ID: null,
};
let isUpdating = false;

export const startGlobalInteractionTracking = async (
  event,
  item,
  component,
  userData,
  chatSession
) => {
  if (isUpdating) {
    return;
  }
  isUpdating = true;

  try {
    currentSessionID = interactions.chat_session_ID || null;
    if (currentSessionID && currentSessionID !== lastSessionID) {
      // await updateUserInteractionData("chatSessionUpdate")
      sessionStorage.removeItem('cookieInteraction');
      resetSessionData();
      resetSerializedInteractions();

      lastSessionID = currentSessionID;
    }

    interactions.chat_session_ID = chatSession;

    let eventText =
      event?.target?.innerText ||
      event?.clipboardData?.getData('text') ||
      window.getSelection().toString() ||
      '';

    if (eventText.includes('...Read More')) {
      eventText = eventText.replace('...Read More', '').trim();
    }
    if (eventText === 'Read More') {
      const parentText = event?.target?.parentElement?.innerText || '';
      eventText = parentText.replace('...Read More', '').trim();
    }

    let adId = null;
    if (Array.isArray(item)) {
      adId =
        item.find((ad) =>
          ['adTitle', 'postOwner', 'newsfeedDescription', 'description'].some((key) =>
            ad[key]?.includes?.(eventText)
          )
        )?.id ||
        item[1]?.split('-')[1] ||
        null;
    } else if (item && typeof item === 'object') {
      adId = item?.id || null;
    }

    let network = null;
    let postOwner = null;

    if (Array.isArray(item)) {
      const matched = item[0].find((e) => e.id == adId);
      network = matched?.network || null;
      postOwner = matched?.postOwner || null;
    } else {
      network = item?.network || null;
      postOwner = item?.postOwner || null;
    }

    const interactionDetails = {
      adId,
      component,
      target: event?.target?.tagName || null,
      innerText: event?.target?.innerText || null,
      timestamp: new Date().toISOString(),
      network,
      postOwner,
    };

    if (component === 'adCard') {
      handleAdCardInteraction(event, item, component, interactionDetails);
    } else if (component === 'lineChart' || component === 'piChart') {
      handleChartInteraction(event, item, component, interactionDetails);
    } else if (component === 'postOwnerGraph') {
      handlePostOwnerGraphInteraction(event, item, interactionDetails);
    } else if (component === 'GeoGraph') {
      handleGeoGraphInteraction(event, item, interactionDetails);
    } else if (component === 'scrollAdContainer' || component === 'scrollChartContainer') {
      handleScrollInteraction(event, item, component, interactionDetails);
    } else if (component === 'chatBot') {
      handleChatBotInteraction(event, component, interactionDetails);
    } else if (component === 'chatbot-card') {
      handleChatBotCardInteraction(event, item, component, interactionDetails);
    } else if (component === 'adCopyCard') {
      handleAdCreativeCardInteraction(event, item, component, interactionDetails);
    } else if (component === 'adCopySidebar') {
      const adCopySidebarDetails = {
        // ad_description: item?.ad_description || null,
        // ad_title: item?.ad_title || null,
        brand_description: item?.brand_description || null,
        brand_name: item?.brand_name || null,
        cta: item?.cta || null,
        // noOfCopy: item['no_of_ad_copies'] || null,
        platform: item?.platform || null,
        // userQuery: item['user_query'] || null,
        // userQuery2: item['user_query2'] || null,
        adCopyChatSession: sessionStorage.getItem('adCopyChatSessionId'),
        timestamp: new Date().toISOString(),
      };
      interactions.adCreativeSide = [];
      interactions.adCopySide.push(adCopySidebarDetails);
    } else if (component === 'adCreativeSidebar') {
      const adCreativeDetails = {
        // adDescription: item?.ad_description || null,
        // adTitle: item?.ad_title || null,
        brandDescription: item?.brand_description || null,
        brandName: item?.brand_name || null,
        cta: item?.cta || null,
        // noOfCopy: item['no_of_ad_copies'] || null,
        platform: item?.platform || null,
        // userQuery: item['user_query'] || null,
        // userQuery2: item['user_query2'] || null,
        adCopyChatSession: item?.sessionId,
        timestamp: new Date().toISOString(),
      };
      interactions.adCreativeSide = [];
      interactions.adCreativeSide.push(adCreativeDetails);
    } else if (component === 'pageRedirect') {
      if (!interactions.pageLocation[userData?.sessionId]) {
        pageRedirectId = crypto.randomUUID();
        pageEnterTime = new Date().toISOString();

        const pageRedirectDetails = {
          pageRedirectId,
          enterTime: pageEnterTime,
          path: event?.pathname || window.location.pathname,
          userId: userData?.user_id || null,
          timestamp: new Date().toISOString(),
        };
        interactions.pageLocation[userData?.sessionId] = pageRedirectDetails;
      }
    }

    const serializedInteractions = {
      clicks: { chat_session_ID: chatSession, data: interactions.clicks },
      hovers: { chat_session_ID: chatSession, data: interactions.hovers },
      copies: { chat_session_ID: chatSession, data: interactions.copies },
      scrolls: { chat_session_ID: chatSession, data: interactions.scrolls },
      pageLocation: {
        sessionId: userData?.sessionId,
        data: interactions.pageLocation[userData?.sessionId] || null,
      },
      adCopySide: interactions?.adCopySide || null,
      adCreativeSide: interactions?.adCreativeSide || null,
      user_id: userData?.user_id || null,
      user_name: userData?.user_name || null,
      user_email: userData?.user_email || null,
      sessionId: userData?.sessionId || null,
    };

    sendInteractionDataIfChanged(serializedInteractions);
  } catch (error) {
    console.log(error);
  } finally {
    isUpdating = false;
  }
};

const handleAdCardInteraction = (event, item, component, interactionDetails) => {
  const interactionKey = `${interactionDetails.adId}-${component}`;
  if (event.type === 'click' && interactionDetails.target === 'BUTTON') {
    updateInteractionCount(interactions.clicks, interactionKey, interactionDetails);
  }
  if (event.type === 'click' && event.target.parentElement.tagName === 'BUTTON') {
    interactionDetails.innerText = 'Recreate Sucessful Ad';
    interactionDetails.adCodpySession = sessionStorage.getItem('adCopyChatSessionId');
    updateInteractionCount(interactions.clicks, interactionKey, interactionDetails);
  } else if (event.type === 'copy') {
    handleCopy(event, item, component);
  }
};

const handleAdCreativeCardInteraction = (event, item, component, interactionDetails) => {
  const interactionKey = `${interactionDetails.adId}-${component}`;
  if (event.type === 'click' && interactionDetails.target === 'BUTTON') {
    updateInteractionCount(interactions.clicks, interactionKey, interactionDetails);
  }
  if (event.type === 'click' && event.target.parentElement.tagName === 'BUTTON') {
    interactionDetails.innerText = 'Recreate Sucessful Ad';
    interactionDetails.adCodpySession = sessionStorage.getItem('adCopyChatSessionId');
    updateInteractionCount(interactions.clicks, interactionKey, interactionDetails);
  } else if (event.type === 'copy') {
    handleAdCopy(event, item, component, interactionDetails);
  }
};

const handleChartInteraction = (event, item, component, interactionDetails) => {
  const interactionKey = `${generateUniqueId(item)}-${component}`;
  item.timestamp = new Date().toISOString();
  if (event.type === 'click') {
    updateInteractionCount(interactions.clicks, ' interactionKey', item);
  } else if (event.type === 'mouseover') {
    if (lastHoveredElement !== event.target) {
      clearTimeout(hoverTimeout);
      lastHoveredElement = event.target;
    }
    trackHoverInteraction(interactionKey, item);
  }
};

const handlePostOwnerGraphInteraction = (event, item, interactionDetails) => {
  const isDistributionOfCTAs = interactionDetails.innerText?.includes(
    'Distribution of Call to Actions'
  );
  const interactionKey = generateUniqueId(isDistributionOfCTAs ? item?.barChart2 : item?.barChart1);
  item = isDistributionOfCTAs ? item?.barChart2 : item?.barChart1;
  item.timestamp = new Date().toISOString();
  const interactionMap = {
    click: interactions.clicks,
    mouseover: interactions.hovers,
  };
  if (interactionMap[event.type]) {
    if (event.type === 'mouseover') {
      if (lastHoveredElement !== event.target) {
        clearTimeout(hoverTimeout);
        lastHoveredElement = event.target;
      }
      trackHoverInteraction(interactionKey, item);
    } else {
      updateInteractionCount(interactionMap[event.type], interactionKey, item);
    }
  }
};

const handleGeoGraphInteraction = (event, item, interactionDetails) => {
  const interactionKey = `${generateUniqueId(item)}-GeoGraph`;
  item.timestamp = new Date().toISOString();
  if (event.type === 'mouseover') {
    if (lastHoveredElement !== event.target) {
      clearTimeout(hoverTimeout);
      lastHoveredElement = event.target;
    }
    trackHoverInteraction(interactionKey, item);
  }
};

const handleScrollInteraction = (event, item, component, interactionDetails) => {
  const interactionKey = `${component}`;
  const scrollContainer = event.target;
  const scrollTop = scrollContainer.scrollTop;
  const scrollHeight = scrollContainer.scrollHeight;
  const clientHeight = scrollContainer.clientHeight;
  const percentSeen = Math.min(((scrollTop + clientHeight) / scrollHeight) * 100, 100);

  if (!item.scrollCount) item.scrollCount = 0;
  item.scrollCount++;

  const newDataFetched = item.length;

  interactionDetails.scrollTop = scrollTop;
  interactionDetails.scrollHeight = scrollHeight;
  interactionDetails.clientHeight = clientHeight;
  interactionDetails.percentSeen = percentSeen;
  interactionDetails.scrollCount = item.scrollCount;
  interactionDetails.newDataFetched = newDataFetched;

  if (!interactions.scrolls[interactionKey]) {
    interactions.scrolls[interactionKey] = {
      scrollCount: 0,
      totalPercentSeen: 0,
      totalNewDataFetched: 0,
      adId: item.map((e) => `${e.id}-${e.network}`),
      timestamp: new Date().toISOString(),
    };
  }

  const scrollData = interactions.scrolls[interactionKey];

  if (percentSeen === 100) {
    scrollData.scrollCount = item.scrollCount;
    scrollData.totalPercentSeen = 100;
    scrollData.totalNewDataFetched = newDataFetched;
    scrollData.scrollTop = scrollTop;
    scrollData.scrollHeight = scrollHeight;
    scrollData.clientHeight = clientHeight;
    ((scrollData['timestamp'] = new Date().toISOString()),
      (scrollData.adId = [...scrollData.adId, ...item.map((e) => `${e.id}-${e.network}`)]));
  }
};

const handleChatBotInteraction = (event, component, interactionDetails) => {
  const interactionKey = `${component}`;
  if (event.type === 'click') {
    updateInteractionCount(interactions.clicks, interactionKey, {
      timestamp: interactionDetails.timestamp,
    });
  }
};

const handleChatBotCardInteraction = (event, item, component, interactionDetails) => {
  const target = event.target;
  const parent = target.parentElement;

  const interactionChatDetails = {
    component,
    target: {
      tagName: target.tagName,
      id: target.id || null,
      className: target.className || null,
      src: target.src || null,
    },
    parent: parent
      ? {
          tagName: parent.tagName,
          id: parent.id || null,
          className: parent.className || null,
        }
      : null,
    innerText: target.innerText || parent?.className || null,
    timestamp: new Date().toISOString(),
  };

  const interactionKey = `${component}`;
  try {
    const tooltipContent = target.getAttribute('data-tooltip-content');
    const isButton = target.tagName === 'BUTTON' || (parent && parent.tagName === 'BUTTON');
    const isSearchAdvertiser = tooltipContent?.includes('Search Advertiser');

    if (event.type === 'click') {
      if (isButton) {
        updateInteractionCount(
          interactions.clicks,
          `${interactionKey}-${parent?.className || target.className}`,
          interactionChatDetails
        );
      } else if (isSearchAdvertiser) {
        updateInteractionCount(
          interactions.clicks,
          `${interactionKey}-Search Advertiser`,
          interactionChatDetails
        );
      } else if (
        (parent?.tagName === 'SPAN' &&
          String(parent?.className)?.includes(
            'bg-[#2F40A7] absolute flex justify-center items-center rounded-full right-2 bottom-2 h-5 w-5 cursor-pointer'
          )) ||
        String(target?.className)?.includes(
          'bg-[#2F40A7] absolute flex justify-center items-center rounded-full right-2 bottom-2 h-5 w-5 cursor-pointer'
        )
      ) {
        const innerText = JSON.parse(sessionStorage.getItem('ADV'));
        sessionStorage.removeItem('ADV');

        if (innerText.length > 0) {
          updateInteractionCount(
            interactions.clicks,
            `${interactionKey}-${generateMiniUniqueID()}-AdvertiserValue`,
            { advertiserSearchValue: innerText, timestamp: new Date().toISOString() }
          );
        }
      }
    } else if (event.type === 'copy') {
      handleCopy(event, item, component);
    }
  } catch {
    // Interaction tracking is best-effort; swallow errors so they never
    // disrupt the user-facing flow.
  }
};

function generateMiniUniqueID() {
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

const updateInteractionCount = (interactionMap, key, details, isCopy = false) => {
  if (interactionMap[key]) {
    const existing = interactionMap[key];
    existing.count += 1;
    existing.lastTimestamp = details.timestamp;
    if (isCopy) existing.copiedText = [details.copiedText];
  } else {
    const newEntry = { ...details, count: 1, lastTimestamp: details.timestamp };
    if (isCopy) newEntry.copiedText = [details.copiedText];
    interactionMap[key] = newEntry;
  }
};

// const updateInteractionCount = (interactionMap, key, details, isCopy = false) => {
//   if (interactionMap[key]) {
//     const existing = interactionMap[key];
//     existing.count += 1;
//     existing.lastTimestamp = details.timestamp;
//     if (isCopy) existing.copiedText.push(details.copiedText);
//   } else {
//     const newEntry = { ...details, count: 1, lastTimestamp: details.timestamp };
//     if (isCopy) newEntry.copiedText = [details.copiedText];
//     interactionMap[key] = newEntry;
//   }
// };

const trackHoverInteraction = (interactionKey, item) => {
  clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(() => {
    updateInteractionCount(interactions.hovers, interactionKey, item);
  }, 5000);
};

const handleCopy = (event, item, component) => {
  const copiedText = event.clipboardData?.getData('text') || window.getSelection().toString();
  if (copiedText) {
    navigator.clipboard.writeText(copiedText);

    const interactionDetails = {
      adId: item.id,
      component,
      copiedText,
      postOwner: item.postOwner,
      timestamp: new Date().toISOString(),
    };
    const interactionKey = `${interactionDetails.adId ? interactionDetails.adId : 'chats'}-${component}`;
    updateInteractionCount(interactions.copies, interactionKey, interactionDetails, true);
    event.preventDefault();
  }
};

const handleAdCopy = (event, item, component, interactionDetails) => {
  const copiedText = event.clipboardData?.getData('text') || window.getSelection().toString();
  if (copiedText) {
    navigator.clipboard.writeText(copiedText);
    interactionDetails['copiedText'] = copiedText;
    const interactionKey = `${interactionDetails.adId ? interactionDetails.adId : 'chats'}-${component}`;
    updateInteractionCount(interactions.copies, interactionKey, interactionDetails, true);
    event.preventDefault();
  }
};

const generateUniqueId = (obj) => {
  const serializedObject = JSON.stringify({
    chartArr:
      obj.chartArr?.map((chart) => ({
        name: chart.name,
        data: chart?.data?.join(',') || chart?.value || chart?.steps,
      })) || [],
    cards: obj.cards || [],
    title: obj.title || '',
    ads:
      obj.ads?.map((ad) => ({
        id: ad.id,
        network: ad.network,
        postOwner: ad.postOwner,
        adTitle: ad.adTitle,
        popularityIndex: ad.popularityIndex,
        lastSeen: ad.lastSeen,
      })) || [],
  });

  let hash = 0;
  for (let i = 0; i < serializedObject.length; i++) {
    hash = (hash << 5) - hash + serializedObject.charCodeAt(i);
  }

  return hash.toString();
};

const sendInteractionDataIfChanged = async (serializedData) => {
  try {
    if (!deepCompare(lastInteractions, serializedData)) {
      await updateUserInteractionData(serializedData);
      sessionStorage.setItem('cookieInteraction', JSON.stringify(serializedData));
      // await updateUserInteractionData(serializedData)
      lastInteractions = JSON.parse(JSON.stringify(serializedData));
    }
  } catch {
    // Best-effort persistence; ignore failures (e.g. storage quota / offline).
  }
};

const resetSessionData = () => {
  interactions.clicks = {};
  interactions.hovers = {};
  interactions.copies = {};
  interactions.scrolls = {};
  interactions.chat_session_ID = null;
  interactions.adCopySide = [];
  interactions.adCreativeSide = [];
  interactions.pageLocation = {};
};

const resetSerializedInteractions = () => {
  lastInteractions = null;
};

export const updateUserInteractionData = async (payload) => {
  const url = `${import.meta.env.VITE_SOCKET_URL}/adsgpt/user-intreaction-data/update`;

  try {
    if (!payload || !payload.clicks || !payload.clicks['chat_session_ID']) {
      return null;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token ? token : getCookies()}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    return null;
  }
};

function deepCompare(obj1, obj2) {
  if (obj1 === obj2) return true;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) {
    return false;
  }
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  if (keys1.length !== keys2.length) return false;
  for (let key of keys1) {
    if (!keys2.includes(key)) return false;
    if (!deepCompare(obj1[key], obj2[key])) return false;
  }
  return true;
}
