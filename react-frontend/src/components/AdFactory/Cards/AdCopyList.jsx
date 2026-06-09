import { useEffect, useState, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { data, useSearchParams } from 'react-router-dom';
import {
  FaFacebook,
  FaWhatsapp,
  FaSnapchat,
  FaTwitter,
  FaLinkedin,
  FaChevronLeft,
  FaChevronRight,
  FaGoogle,
  FaPinterest,
  FaReddit,
  FaCopy,
  FaCheck,
  FaDownload,
} from 'react-icons/fa';
import { SiTiktok } from 'react-icons/si';
import { fetchAdFactoryHistory } from '@/store/actions/adFactoryNew/adFactoryActions';
import { toast } from 'react-hot-toast';
import { GoGlobe } from 'react-icons/go';

export const AdCopyList = () => {
  const [selected, setSelected] = useState(0);
  const [copiedItems, setCopiedItems] = useState({}); // Track copied items
  const [copiedHistoryItems, setCopiedHistoryItems] = useState({}); // Track copied history items
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams?.get?.('campaignId');
  const [selectedPlatform, setSelectedPlatform] = useState('All');
  const { userData } = useSelector((state) => state?.socket) || {};
  const { results, history } = useSelector((state) => state?.adFactoryNew) || {};
  const queryCampaignId = searchParams?.get?.('campaignId');

  // Extract current result data
  const resultData = results?.text || [];
  const adCopies =
    resultData?.map?.((item, index) => ({
      ...item,
      id: index,
      variations: item?.data || {},
    })) || [];

  // Extract history data
  const historyData = history || [];

  // Platform icons data
  const platforms = [
    { name: 'All', key: 'all', icon: <GoGlobe /> },
    { name: 'Meta', key: 'meta', icon: <FaFacebook /> },
    { name: 'Google', key: 'google', icon: <FaGoogle /> },
    { name: 'TikTok', key: 'tiktok', icon: <SiTiktok /> },
    { name: 'Snapchat', key: 'snapchat', icon: <FaSnapchat /> },
    { name: 'LinkedIn', key: 'linkedin', icon: <FaLinkedin /> },
    { name: 'Twitter', key: 'twitter', icon: <FaTwitter /> },
    { name: 'Pinterest', key: 'pinterest', icon: <FaPinterest /> },
    { name: 'Reddit', key: 'reddit', icon: <FaReddit /> },
    { name: 'WhatsApp', key: 'whatsapp', icon: <FaWhatsapp /> },
  ];

  const carouselRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  // Fetch history data
  useEffect(() => {
    if (queryCampaignId && userData?.user_id) {
      const campaignPayload = {
        campaignId: queryCampaignId,
        userId: userData?.user_id,
      };
      dispatch(fetchAdFactoryHistory(campaignPayload));
    }
  }, [dispatch, queryCampaignId, userData]);

  // Get platform key from platform name
  const getPlatformKey = (platformName) => {
    const platform = platforms?.find?.(
      (p) => p?.name === platformName || p?.key === platformName?.toLowerCase?.()
    );
    return platform?.key || platformName?.toLowerCase?.();
  };

  const getFilteredAdCopies = () => {
    if (selectedPlatform === 'All') {
      return (
        adCopies?.map?.((copy, index) => {
          // Get all platform data from variations
          const allPlatformsData = [];

          // Check each platform in the variations
          Object.keys(copy?.variations || {}).forEach((platformKey) => {
            const platformData = copy?.variations?.[platformKey];
            if (platformData) {
              const platformObj = platforms.find((p) => p.key === platformKey);
              if (platformObj) {
                allPlatformsData.push({
                  platformKey,
                  platformName: platformObj.name,
                  platformIcon: platformObj.icon,
                  data: platformData,
                });
              }
            }
          });

          // If no specific platform data found, use meta as fallback
          if (allPlatformsData.length === 0 && copy?.variations?.meta) {
            allPlatformsData.push({
              platformKey: 'meta',
              platformName: 'Meta',
              platformIcon: <FaFacebook />,
              data: copy?.variations?.meta,
            });
          }

          return {
            ...copy,
            id: index,
            allPlatformsData, // Array of all platform data
            platformData: allPlatformsData[0]?.data, // First platform for default display
            platformKey: allPlatformsData[0]?.platformKey || 'meta',
          };
        }) || []
      );
    }

    // For specific platform selection
    const platformKey = getPlatformKey(selectedPlatform);
    return (
      adCopies
        ?.filter?.((copy) => copy?.variations && copy?.variations[platformKey])
        ?.map?.((copy, index) => ({
          ...copy,
          id: index,
          platformData: copy?.variations?.[platformKey],
          platformKey,
          allPlatformsData: [
            {
              platformKey,
              platformName: selectedPlatform,
              data: copy?.variations?.[platformKey],
            },
          ],
        })) || []
    );
  };
  // Filter history data based on selected platform
  const getFilteredHistory = () => {
    if (selectedPlatform === 'All') return historyData;

    const platformKey = getPlatformKey(selectedPlatform);
    return (
      historyData
        ?.map?.((historyItem) => {
          const textData = historyItem?.previousData?.results?.text || [];
          const hasPlatform = textData?.some?.(
            (item) => item?.status === 200 && item?.data && item?.data?.[platformKey]
          );
          return hasPlatform ? historyItem : null;
        })
        ?.filter?.((item) => item !== null) || []
    );
  };

  const filteredAdCopies = getFilteredAdCopies();
  console.log(filteredAdCopies,'filtered ad copies')
  const filteredHistory = getFilteredHistory();

  // Function to check scroll position
  const updateArrows = () => {
    if (carouselRef?.current) {
      const { scrollLeft, scrollWidth, clientWidth } = carouselRef.current;
      setShowLeftArrow(scrollLeft > 0);
      setShowRightArrow(scrollLeft + clientWidth < scrollWidth - 10);
    }
  };

  const scrollLeft = () => {
    if (carouselRef?.current) {
      carouselRef.current.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (carouselRef?.current) {
      carouselRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  // Function to copy text from current ad copy
  const copyAdCopyText = (item, index) => {
    try {
      let textToCopy = '';
      const platformKey = item?.platformKey || getPlatformKey(selectedPlatform);

      if (
        platformKey === 'meta' ||
        platformKey === 'google' ||
        platformKey === 'linkedin' ||
        platformKey === 'pinterest'
      ) {
        textToCopy = [
          item?.platformData?.headline,
          item?.platformData?.primary_text,
          item?.platformData?.description,
        ]
          .filter(Boolean)
          .join('\n\n');
      } else if (platformKey === 'tiktok' || platformKey === 'snapchat') {
        textToCopy = [item?.platformData?.caption, item?.platformData?.short_description]
          .filter(Boolean)
          .join('\n\n');
      } else if (platformKey === 'twitter') {
        textToCopy = item?.platformData?.message || '';
      } else if (platformKey === 'reddit') {
        textToCopy = [item?.platformData?.title, item?.platformData?.body]
          .filter(Boolean)
          .join('\n\n');
      } else if (platformKey === 'whatsapp') {
        textToCopy = item?.platformData?.message || '';
      } else {
        textToCopy = Object.values(item?.platformData || {})
          .filter(Boolean)
          .join('\n\n');
      }

      if (!textToCopy.trim()) {
        textToCopy = 'No content available to copy.';
      }

      navigator.clipboard
        .writeText(textToCopy)
        .then(() => {
          setCopiedItems((prev) => ({ ...prev, [index]: true }));

          setTimeout(() => {
            setCopiedItems((prev) => ({ ...prev, [index]: false }));
          }, 2000);

          toast.success('Ad copy copied to clipboard!', {
            position: 'bottom-right',
            duration: 2000,
          });
        })
        .catch((err) => {
          console.error('Failed to copy:', err);
          toast.error('Failed to copy text', {
            position: 'bottom-right',
            duration: 2000,
          });
        });
    } catch (error) {
      console.error('Error copying text:', error);
      toast.error('Error copying text', {
        position: 'bottom-right',
        duration: 2000,
      });
    }
  };

  // Function to copy text from history ad copy
  const copyHistoryText = (platformData, platformKey, historyId, itemIndex) => {
    try {
      let textToCopy = '';

      if (
        platformKey === 'meta' ||
        platformKey === 'google' ||
        platformKey === 'linkedin' ||
        platformKey === 'pinterest'
      ) {
        textToCopy = [platformData?.headline, platformData?.primary_text, platformData?.description]
          .filter(Boolean)
          .join('\n\n');
      } else if (platformKey === 'tiktok' || platformKey === 'snapchat') {
        textToCopy = [platformData?.caption, platformData?.short_description]
          .filter(Boolean)
          .join('\n\n');
      } else if (platformKey === 'twitter') {
        textToCopy = platformData?.message || '';
      } else if (platformKey === 'reddit') {
        textToCopy = [platformData?.title, platformData?.body].filter(Boolean).join('\n\n');
      } else if (platformKey === 'whatsapp') {
        textToCopy = platformData?.message || '';
      } else {
        textToCopy = Object.values(platformData || {})
          .filter(Boolean)
          .join('\n\n');
      }

      if (!textToCopy.trim()) {
        textToCopy = 'No content available to copy.';
      }

      navigator.clipboard
        .writeText(textToCopy)
        .then(() => {
          setCopiedHistoryItems((prev) => ({ ...prev, [`${historyId}-${itemIndex}`]: true }));

          setTimeout(() => {
            setCopiedHistoryItems((prev) => ({ ...prev, [`${historyId}-${itemIndex}`]: false }));
          }, 2000);

          toast.success('Ad copy copied to clipboard!', {
            position: 'bottom-right',
            duration: 2000,
          });
        })
        .catch((err) => {
          console.error('Failed to copy:', err);
          toast.error('Failed to copy text', {
            position: 'bottom-right',
            duration: 2000,
          });
        });
    } catch (error) {
      console.error('Error copying text:', error);
      toast.error('Error copying text', {
        position: 'bottom-right',
        duration: 2000,
      });
    }
  };

  // Function to get all text from an ad copy (for "All" platforms view)
  const getAllTextFromItem = (item) => {
    if (!item?.variations) return '';

    let allText = '';
    Object.keys(item.variations).forEach((platformKey) => {
      const platformData = item.variations[platformKey];
      if (platformData) {
        allText += `${platformKey.toUpperCase()}:\n`;

        if (
          platformKey === 'meta' ||
          platformKey === 'google' ||
          platformKey === 'linkedin' ||
          platformKey === 'pinterest'
        ) {
          if (platformData.headline) allText += `Headline: ${platformData.headline}\n`;
          if (platformData.primary_text) allText += `Text: ${platformData.primary_text}\n`;
          if (platformData.description) allText += `Description: ${platformData.description}\n`;
        } else if (platformKey === 'tiktok' || platformKey === 'snapchat') {
          if (platformData.caption) allText += `Caption: ${platformData.caption}\n`;
          if (platformData.short_description)
            allText += `Description: ${platformData.short_description}\n`;
        } else if (platformKey === 'twitter') {
          if (platformData.message) allText += `Tweet: ${platformData.message}\n`;
        } else if (platformKey === 'reddit') {
          if (platformData.title) allText += `Title: ${platformData.title}\n`;
          if (platformData.body) allText += `Body: ${platformData.body}\n`;
        } else if (platformKey === 'whatsapp') {
          if (platformData.message) allText += `Message: ${platformData.message}\n`;
        }

        allText += '\n';
      }
    });

    return allText.trim();
  };

  // Function to copy all text (for "All" platforms view)
  const copyAllPlatformsText = (item, index) => {
    try {
      let textToCopy = getAllTextFromItem(item);

      if (!textToCopy.trim()) {
        textToCopy = 'No content available to copy.';
      }

      navigator.clipboard
        .writeText(textToCopy)
        .then(() => {
          setCopiedItems((prev) => ({ ...prev, [index]: true }));

          setTimeout(() => {
            setCopiedItems((prev) => ({ ...prev, [index]: false }));
          }, 2000);

          toast.success('All platform ad copies copied to clipboard!', {
            position: 'bottom-right',
            duration: 2000,
          });
        })
        .catch((err) => {
          console.error('Failed to copy:', err);
          toast.error('Failed to copy text', {
            position: 'bottom-right',
            duration: 2000,
          });
        });
    } catch (error) {
      console.error('Error copying text:', error);
      toast.error('Error copying text', {
        position: 'bottom-right',
        duration: 2000,
      });
    }
  };

  // Function to download text as a file
  const downloadTextAsFile = (text, filename) => {
    try {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'ad_copy.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Text downloaded successfully!', {
        position: 'bottom-right',
        duration: 2000,
      });
    } catch (error) {
      console.error('Error downloading text:', error);
      toast.error('Failed to download text', {
        position: 'bottom-right',
        duration: 2000,
      });
    }
  };

  // Function to download current ad copy text
  const downloadAdCopyText = (item, index) => {
    try {
      let textToDownload = '';
      const platformKey = item?.platformKey || getPlatformKey(selectedPlatform);

      if (selectedPlatform === 'All') {
        textToDownload = getAllTextFromItem(item);
      } else if (
        platformKey === 'meta' ||
        platformKey === 'google' ||
        platformKey === 'linkedin' ||
        platformKey === 'pinterest'
      ) {
        textToDownload = [
          `Headline: ${item?.platformData?.headline || ''}`,
          `Primary Text: ${item?.platformData?.primary_text || ''}`,
          `Description: ${item?.platformData?.description || ''}`,
        ]
          .filter((line) => !line.endsWith(': '))
          .join('\n\n');
      } else if (platformKey === 'tiktok' || platformKey === 'snapchat') {
        textToDownload = [
          `Caption: ${item?.platformData?.caption || ''}`,
          `Description: ${item?.platformData?.short_description || ''}`,
        ]
          .filter((line) => !line.endsWith(': '))
          .join('\n\n');
      } else if (platformKey === 'twitter') {
        textToDownload = item?.platformData?.message || '';
      } else if (platformKey === 'reddit') {
        textToDownload = [
          `Title: ${item?.platformData?.title || ''}`,
          `Body: ${item?.platformData?.body || ''}`,
        ]
          .filter((line) => !line.endsWith(': '))
          .join('\n\n');
      } else if (platformKey === 'whatsapp') {
        textToDownload = item?.platformData?.message || '';
      } else {
        textToDownload = Object.entries(item?.platformData || {})
          .map(([key, value]) => `${key}: ${value}`)
          .filter(Boolean)
          .join('\n\n');
      }

      if (!textToDownload.trim()) {
        textToDownload = 'No content available to download.';
      }

      const filename = `ad_copy_${selectedPlatform}_${index + 1}_${new Date().toISOString().split('T')[0]}.txt`;
      downloadTextAsFile(textToDownload, filename);
    } catch (error) {
      console.error('Error preparing text for download:', error);
      toast.error('Error preparing text for download', {
        position: 'bottom-right',
        duration: 2000,
      });
    }
  };

  // Function to download history text
  const downloadHistoryText = (platformData, platformKey, historyItem, itemIndex) => {
    try {
      let textToDownload = '';

      if (
        platformKey === 'meta' ||
        platformKey === 'google' ||
        platformKey === 'linkedin' ||
        platformKey === 'pinterest'
      ) {
        textToDownload = [
          `Headline: ${platformData?.headline || ''}`,
          `Primary Text: ${platformData?.primary_text || ''}`,
          `Description: ${platformData?.description || ''}`,
        ]
          .filter((line) => !line.endsWith(': '))
          .join('\n\n');
      } else if (platformKey === 'tiktok' || platformKey === 'snapchat') {
        textToDownload = [
          `Caption: ${platformData?.caption || ''}`,
          `Description: ${platformData?.short_description || ''}`,
        ]
          .filter((line) => !line.endsWith(': '))
          .join('\n\n');
      } else if (platformKey === 'twitter') {
        textToDownload = platformData?.message || '';
      } else if (platformKey === 'reddit') {
        textToDownload = [
          `Title: ${platformData?.title || ''}`,
          `Body: ${platformData?.body || ''}`,
        ]
          .filter((line) => !line.endsWith(': '))
          .join('\n\n');
      } else if (platformKey === 'whatsapp') {
        textToDownload = platformData?.message || '';
      } else {
        textToDownload = Object.entries(platformData || {})
          .map(([key, value]) => `${key}: ${value}`)
          .filter(Boolean)
          .join('\n\n');
      }

      if (!textToDownload.trim()) {
        textToDownload = 'No content available to download.';
      }

      const dateStr = new Date(historyItem?.createdAt).toISOString().split('T')[0];
      const filename = `ad_copy_${selectedPlatform}_v${historyItem?.version}_${itemIndex + 1}_${dateStr}.txt`;
      downloadTextAsFile(textToDownload, filename);
    } catch (error) {
      console.error('Error preparing history text for download:', error);
      toast.error('Error preparing text for download', {
        position: 'bottom-right',
        duration: 2000,
      });
    }
  };

  // Add event listener for scroll
  useEffect(() => {
    const carousel = carouselRef?.current;
    if (carousel) {
      carousel.addEventListener('scroll', updateArrows);
      updateArrows();

      return () => carousel?.removeEventListener?.('scroll', updateArrows);
    }
  }, []);

  // Helper function to render content based on platform
  const renderPlatformContent = (
    platformData,
    platformKey,
    showDownloadButton = false,
    item = null,
    index = null,
    isHistory = false,
    historyItem = null
  ) => {
    const content = (() => {
      switch (platformKey) {
        case 'meta':
        case 'google':
        case 'linkedin':
        case 'pinterest':
          return (
            <>
              {platformData?.headline && (
                <p className="mb-2 text-sm font-medium text-gray-900 dark:text-white">{platformData.headline}</p>
              )}
              {platformData?.primary_text && (
                <p className="mb-3 text-sm leading-relaxed text-gray-500 dark:text-[#D5D5D5]">
                  {platformData.primary_text}
                </p>
              )}
              {platformData?.description && (
                <p className="text-sm text-gray-500 italic dark:text-[#B0B0B0]">{platformData.description}</p>
              )}
            </>
          );
        case 'tiktok':
        case 'snapchat':
          return (
            <>
              {platformData?.caption && (
                <p className="mb-3 text-sm leading-relaxed text-gray-500 dark:text-[#D5D5D5]">
                  {platformData.caption}
                </p>
              )}
              {platformData?.short_description && (
                <p className="text-sm font-medium text-gray-900 dark:text-white">{platformData.short_description}</p>
              )}
            </>
          );
        case 'twitter':
          return (
            <>
              {platformData?.message && (
                <p className="mb-3 text-sm leading-relaxed text-gray-500 dark:text-[#D5D5D5]">
                  {platformData.message}
                </p>
              )}
            </>
          );
        case 'reddit':
          return (
            <>
              {platformData?.title && (
                <p className="mb-2 text-sm font-medium text-gray-900 dark:text-white">{platformData.title}</p>
              )}
              {platformData?.body && (
                <p className="mb-3 text-sm leading-relaxed text-gray-500 dark:text-[#D5D5D5]">{platformData.body}</p>
              )}
            </>
          );
        case 'whatsapp':
          return (
            <>
              {platformData?.message && (
                <p className="mb-3 text-sm leading-relaxed whitespace-pre-line text-gray-500 dark:text-[#D5D5D5]">
                  {platformData.message}
                </p>
              )}
            </>
          );
        default:
          return (
            <p className="mb-3 text-sm leading-relaxed text-gray-500 dark:text-[#D5D5D5]">
              Content format not specified for this platform.
            </p>
          );
      }
    })();

    return <div className="relative">{content}</div>;
  };

  // Render history section for a specific platform in a history item
  const renderHistoryPlatformContent = (historyItem, historyIndex) => {
    const platformKey = getPlatformKey(selectedPlatform);
    const textData = historyItem?.previousData?.results?.text || [];

    return textData
      ?.map?.((textItem, index) => {
        if (textItem?.status !== 200 || !textItem?.data || !textItem?.data?.[platformKey]) {
          return null;
        }

        const platformData = textItem?.data?.[platformKey];
        const copyKey = `${historyItem?._id}-${index}`;

        return (
          <div key={index} className="relative mb-4 rounded-lg bg-gray-100 p-3 last:mb-0 dark:bg-[#1a1a1a]">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-[#B0B0B0]">
                  V {historyIndex + 1} • Ad {index + 1}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyHistoryText(platformData, platformKey, historyItem._id, index);
                  }}
                  className="flex items-center gap-1 rounded-full bg-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-300 dark:bg-[#363636] dark:text-[#D5D5D5] dark:hover:bg-[#444444]"
                >
                  {copiedHistoryItems[copyKey] ? (
                    <>
                      <FaCheck className="h-3 w-3 text-green-400" />
                      <span className="text-green-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <FaCopy className="h-3 w-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            {renderPlatformContent(platformData, platformKey, false)}
          </div>
        );
      })
      ?.filter?.((item) => item !== null);
  };

  return (
    <div className="ad_cop_container flex flex-col gap-6">
      {/* Platforms Section with Carousel */}
      <div className="mb-2">
        <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">Text Generation</h2>

        {/* Carousel Container */}
        <div className="relative">
          {/* Left Arrow */}
          {showLeftArrow && (
            <button
              onClick={scrollLeft}
              className="absolute top-1/2 left-0 z-10 -translate-y-1/2 rounded-full bg-gray-200 p-2 text-gray-900 shadow-lg hover:bg-gray-300 dark:bg-[#363636] dark:text-white dark:hover:bg-[#444444]"
            >
              <FaChevronLeft />
            </button>
          )}

          {/* Right Arrow */}
          {showRightArrow && (
            <button
              onClick={scrollRight}
              className="absolute top-1/2 right-0 z-10 -translate-y-1/2 rounded-full bg-gray-200 p-2 text-gray-900 shadow-lg hover:bg-gray-300 dark:bg-[#363636] dark:text-white dark:hover:bg-[#444444]"
            >
              <FaChevronRight />
            </button>
          )}

          {/* Platforms Carousel */}
          <div
            ref={carouselRef}
            className="scrollbar-hide mx-auto flex max-w-[93%] items-center gap-3 overflow-x-auto py-2"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {platforms?.map?.((platform, index) => (
              <div
                key={index}
                onClick={() => setSelectedPlatform(platform?.name)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 whitespace-nowrap transition-colors ${
                  selectedPlatform === platform?.name
                    ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white'
                    : 'bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-[#363636] dark:text-white dark:hover:bg-[#444444]'
                }`}
              >
                <span className="text-lg">{platform?.icon}</span>
                <span className="text-sm font-medium">{platform?.name}</span>
              </div>
            ))}
          </div>
        </div>

        <hr className="mt-6 border-black/10 dark:border-white/10" />
      </div>

      {/* Current Ad Copies Section */}
      {filteredAdCopies?.length > 0 && (
        <>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Current Version</h3>
          {filteredAdCopies?.map?.((item, index) => (
            <div
              key={`current-${item?.id}-${index}`}
              className={`group rounded-xl bg-gradient-to-r ${
                selected === item?.id ? 'from-[#02C8C4] to-[#5867EB]' : 'from-black/5 to-black/5 dark:from-white/10 dark:to-white/10'
              } relative w-full p-[1px] hover:bg-gradient-to-r`}
            >
              <div
                onClick={() => setSelected(item?.id)}
                className={`rounded-xl border bg-gray-50 px-6 py-5 transition-all duration-300 dark:bg-[#292929] ${
                  selected === item?.id
                    ? 'text-gray-900 dark:text-white'
                    : 'border-black/10 text-gray-500 hover:border-black/20 hover:text-black dark:border-white/10 dark:text-[#E7E9E9] dark:hover:border-white/40 dark:hover:text-white'
                }`}
              >
                <div className="mb-4 flex items-center gap-3">
                  <p className="text-base font-semibold text-gray-900 dark:text-white">Ad Copy {item?.id + 1}</p>
                  {selectedPlatform !== 'All' && (
                    <span className="ml-auto rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-3 py-1 text-xs font-medium text-white">
                      {selectedPlatform}
                    </span>
                  )}
                </div>

                {item?.status === null ? (
                  <div className="mt-3 animate-pulse space-y-3">
                    <div className="h-5 max-w-80 rounded-sm bg-black/10 dark:bg-[#ffffff20]"></div>
                    <div className="h-3 w-full rounded-sm bg-black/5 dark:bg-[#ffffff15]"></div>
                    <div className="h-3 w-3/4 rounded-sm bg-black/5 dark:bg-[#ffffff15]"></div>
                  </div>
                ) : item?.status === 200 ? (
                  <>
                    {selectedPlatform === 'All' ? (
                      <div className="space-y-4">
                        {item?.allPlatformsData?.map?.((platform, platformIndex) => (
                          <div key={platformIndex} className="rounded-lg bg-gray-100 p-4 dark:bg-[#222222]">
                            <div className="mb-3 flex items-center gap-2">
                              <span className="text-lg">{platform.platformIcon}</span>
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {platform.platformName}
                              </span>
                              <span
                                className="ml-auto cursor-pointer rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-3 py-1 text-xs font-medium text-white"
                                onClick={(e) => {
                                  e?.stopPropagation?.();
                                  setSelectedPlatform(platform.platformName);
                                }}
                              >
                                {platform.platformName}
                              </span>
                            </div>
                            {renderPlatformContent(platform.data, platform.platformKey, false)}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                // Copy specific platform text
                                const platformKey = platform.platformKey;
                                let textToCopy = '';

                                // Use the same copy logic as in copyAdCopyText but for specific platform
                                if (
                                  platformKey === 'meta' ||
                                  platformKey === 'google' ||
                                  platformKey === 'linkedin' ||
                                  platformKey === 'pinterest'
                                ) {
                                  textToCopy = [
                                    platform.data?.headline,
                                    platform.data?.primary_text,
                                    platform.data?.description,
                                  ]
                                    .filter(Boolean)
                                    .join('\n\n');
                                } else if (platformKey === 'tiktok' || platformKey === 'snapchat') {
                                  textToCopy = [
                                    platform.data?.caption,
                                    platform.data?.short_description,
                                  ]
                                    .filter(Boolean)
                                    .join('\n\n');
                                } else if (platformKey === 'twitter') {
                                  textToCopy = platform.data?.message || '';
                                } else if (platformKey === 'reddit') {
                                  textToCopy = [platform.data?.title, platform.data?.body]
                                    .filter(Boolean)
                                    .join('\n\n');
                                } else if (platformKey === 'whatsapp') {
                                  textToCopy = platform.data?.message || '';
                                }

                                navigator.clipboard.writeText(textToCopy).then(() => {
                                  toast.success(`${platform.platformName} copy copied!`, {
                                    position: 'bottom-right',
                                    duration: 2000,
                                  });
                                });
                              }}
                              className="mt-3 flex items-center gap-1 rounded-full bg-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-300 dark:bg-[#363636] dark:text-[#D5D5D5] dark:hover:bg-[#444444]"
                            >
                              <FaCopy className="h-3 w-3" />
                              <span>Copy {platform.platformName} Text</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        {renderPlatformContent(item?.platformData, item?.platformKey, false)}
                        <div className="flex items-center gap-2">
                          {filteredAdCopies.some((i) => i.data !== '') && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (selectedPlatform === 'All') {
                                  copyAllPlatformsText(item, index);
                                } else {
                                  copyAdCopyText(item, index);
                                }
                              }}
                              className="mt-3 flex items-center gap-1 rounded-full bg-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-300 dark:bg-[#363636] dark:text-[#D5D5D5] dark:hover:bg-[#444444]"
                            >
                              {copiedItems[index] ? (
                                <>
                                  <FaCheck className="h-4 w-4" />
                                  <span>Copied!</span>
                                </>
                              ) : (
                                <>
                                  <FaCopy className="h-4 w-4" />
                                  <span>Copy Text</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-red-400">
                      {item?.status === 400
                        ? 'Content moderation blocked'
                        : 'Failed to generate ad copy.'}
                    </p>
                    {item?.status === 400 && (
                      <p className="text-xs text-red-300 opacity-70">
                        Your credits were not deducted. Please revise your inputs and try again.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {filteredAdCopies?.length === 0 && (
        <div className="rounded-xl bg-gray-50 px-6 py-8 text-center dark:bg-[#292929]">
          <p className="text-gray-500 dark:text-[#D5D5D5]">
            {selectedPlatform === 'All'
              ? 'No Current ad copies available yet.'
              : `No Current ad copies available for ${selectedPlatform}. Try selecting "All" platforms.`}
          </p>
        </div>
      )}
      {/* History Section */}
      {filteredHistory?.length > 0 && selectedPlatform !== 'All' && (
        <>
          <h3 className="mt-8 text-lg font-semibold text-gray-900 dark:text-white">History</h3>
          {filteredHistory?.map?.((historyItem, historyIndex) => (
            <div
              key={`history-${historyItem?._id}`}
              className="group w-full rounded-xl bg-gradient-to-r from-black/5 to-black/5 p-[1px] hover:bg-gradient-to-tr dark:from-white/5 dark:to-white/5"
            >
              <div className="rounded-xl bg-gray-50 px-6 py-5 dark:bg-[#1f1f1f]">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <p className="text-base font-semibold text-gray-900 dark:text-white">V {historyIndex + 1}</p>
                    <span className="rounded-full bg-gray-200 px-3 py-1 text-xs text-gray-500 dark:bg-[#363636] dark:text-[#D5D5D5]">
                      {new Date(historyItem?.createdAt)?.toLocaleDateString?.()}
                    </span>
                  </div>
                  <span className="text-sm text-gray-500 dark:text-[#888]">
                    {historyItem?.previousData?.metadata?.campaignName}
                  </span>
                </div>

                {/* Render all text items for this platform in this history version */}
                {renderHistoryPlatformContent(historyItem, historyIndex)}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};
