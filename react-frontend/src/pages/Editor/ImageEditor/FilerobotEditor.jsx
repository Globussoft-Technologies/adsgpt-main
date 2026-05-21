import { fetchBrands, fetchSavedItems } from '@/store/actions/brandIQ/myBrandActions';
import React, { useEffect, useState } from 'react';
import FilerobotImageEditor, { TABS, TOOLS } from 'react-filerobot-image-editor';
import { useDispatch, useSelector } from 'react-redux';
import { nanoid } from 'nanoid';
import useImage from 'use-image';
import { resetEditorSlice } from '@/store/reducers/adStudio/editorSlice';
import { updateAdCreativeEditorFields } from '@/store/reducers/adStudio/adCreativeSlice';
import { updateFields } from '@/store/actions/adStudio/adCreativeActions';
import { uploadToS3 } from '@/utils/imageUpload';
import { uploadAdFactoryEditedImage } from '@/store/actions/adFactoryNew/adFactoryActions';
import { setEditorFields } from '@/store/reducers/adStudio/editorSlice';
import AdsgptFullLogo from '@/assets/layouts/adsgpt-logo.webp';

export function FilerobotEditor({ source, isImgEditorShown, adIndex, toast }) {
  const { userData } = useSelector((state) => state.socket);
  const { campaignId, historyId, contextType, botId, baseImage } = useSelector(
    (state) => state.editor
  );
  const [logos, setLogos] = useState([]);
  const dispatch = useDispatch();

  const { myBrands } = useSelector((state) => state.brandIQTabs);
  const userId = userData?.user_id;

  useEffect(() => {
    if (Array.isArray(myBrands) && myBrands.length > 0) {
      let urls = [];
      myBrands.forEach((b) => {
        if (b?.logoUrls && Array.isArray(b?.logoUrls) && b.logoUrls.length > 0) {
          b.logoUrls.forEach((url) => {
            urls.push({ name: b?.name, url, id: nanoid() });
          });
        }
      });
      // const brandList = myBrands?.filter((b) => b.logoUrls?.length);
      // setBrands(brandList || []);
      setLogos(urls || []);
    }
  }, [myBrands]);

  useEffect(() => {
    if (userId) dispatch(fetchBrands(userId));
  }, [dispatch, userId]);
  const openImgEditor = () => setIsImgEditorShown(true);
  const closeImgEditor = () => {
    dispatch(resetEditorSlice());
  };

  const updateConversationsState = async (image_url) => {
    // Update local fields
    dispatch(
      updateAdCreativeEditorFields({
        botId,
        index: adIndex,
        field: 'image_ad',
        value: image_url,
      })
    );

    // dispatch(
    //   updateAdCreativeEditorFields({
    //     botId,
    //     index: adIndex,
    //     field: 'logo',
    //     value: selectedLogoUrl,
    //   })
    // );

    // Update history
    dispatch(
      updateFields({
        botId,
        index: adIndex,
        field: 'image_ad',
        value: image_url,
      })
    );
    // dispatch(
    //   updateFields({
    //     botId,
    //     index: adIndex,
    //     field: 'logo',
    //     value: selectedLogoUrl,
    //   })
    // );

    // Update editor state
    dispatch(
      setEditorFields({
        logoImage: selectedLogoUrl,
        baseWithLogoImage: image_url,
      })
    );
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const parent = document.querySelector('.sc-21g986-0.FIE_topbar');
      if (parent && !parent.querySelector('.editor_page_logo')) {
        const img = document.createElement('img');
        img.src = AdsgptFullLogo;
        img.className = 'editor_page_logo';
        img.style.width = '122px';
        img.style.objectFit = 'contain';
        parent.prepend(img);
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="z-50 flex w-full items-center justify-center p-4 md:w-[90%] 2xl:p-9"
      style={{
        height: '100vh',
        margin: '0 auto',
      }}
    >
      {!isImgEditorShown && (
        <button
          onClick={openImgEditor}
          style={{
            padding: '50px 50px',
            fontSize: '16px',
            cursor: 'pointer',
            margin: '20px',
          }}
        >
          Open Filerobot Image Editor
        </button>
      )}

      {isImgEditorShown && (
        <FilerobotImageEditor
          source={source}
          onSave={async (editedImageObject, designState) => {
            const toastId = toast.loading('Saving image to gallery...');
            try {
              // console.log('Saved Image:', editedImageObject);
              // console.log('Design State:', designState);

              // ✅ Download the edited image locally

              // ✅ Convert base64 to file before uploading

              const base64Response = await fetch(editedImageObject.imageBase64);
              const blob = await base64Response.blob();
              const file = new File([blob], editedImageObject.fullName || 'edited-image.png', {
                type: blob.type || 'image/png',
              });

              // ✅ Upload the file
              if (campaignId) {
                // If we have a campaignId, use the AdFactory specific upload
                await dispatch(
                  uploadAdFactoryEditedImage({
                    file,
                    userId: userData?.user_id,
                    campaignId,
                    historyId,
                    contextType,
                    adPath: baseImage,
                    prompt: 'Edited image',
                    timestamp: new Date().toISOString(),
                  })
                ).unwrap();
              } else {
                // Otherwise fallback to generic upload (AdCreative flow)
                const uploadedUrl = await uploadToS3(
                  file,
                  userData?.user_id,
                  false,
                  campaignId,
                  historyId,
                  contextType,
                  baseImage
                );
                // console.log('Uploaded to S3:', uploadedUrl);
                // await updateConversationsState(uploadedUrl);
              }

              // Show success toast
              // ✅ Dismiss loading toast before showing success
              toast.dismiss(toastId);
              toast.success('Image saved successfully!', {
                duration: 3000,
              });
              dispatch(fetchSavedItems({ userId: userData.user_id, skip: 0, limit: 15 }));
              closeImgEditor();
              // console.log('Uploaded to S3:', uploadedUrl);

              // // ✅ Update state with uploaded image URL
              // await updateConversationsState(uploadedUrl);
              // const link = document.createElement('a');
              // link.href = editedImageObject.imageBase64;
              // link.download = editedImageObject.fullName || 'edited-image.png';
              // document.body.appendChild(link);
              // link.click();
              // document.body.removeChild(link);

              // ✅ Optionally close the editor
            } catch (error) {
              console.error('Error while saving image:', error);
            }
          }}
          onClose={closeImgEditor}
          annotationsCommon={{ fill: '#0f0f0f' }}
          Text={{
            text: 'Filerobot...',
            fontFamily: 'Arial',
            fontSize: 18,
            lineHeight: 1.2,
            align: 'left',
          }}
          Rotate={{ angle: 90, componentType: 'slider' }}
          Crop={{
            autoResize: true,
            presetsItems: [
              { titleKey: 'classicTv', descriptionKey: '4:3', ratio: 4 / 3 },
              { titleKey: 'cinemascope', descriptionKey: '21:9', ratio: 21 / 9 },
            ],
            presetsFolders: [
              {
                titleKey: 'socialMedia',
                groups: [
                  {
                    titleKey: 'facebook',
                    items: [
                      {
                        titleKey: 'profile',
                        width: 180,
                        height: 180,
                        descriptionKey: 'fbProfileSize',
                      },
                      {
                        titleKey: 'coverPhoto',
                        width: 820,
                        height: 312,
                        descriptionKey: 'fbCoverPhotoSize',
                      },
                    ],
                  },
                ],
              },
            ],
          }}
          Watermark={{
            gallery: logos,
            textScalingRatio: 0.33,
            imageScalingRatio: 0.33,
            hideTextWatermark: false,
            onUploadWatermarkImgClick: (loadAndSetWatermarkImg) => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/png, image/jpeg, image/webp,image/jpg';
              input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                  const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/jpg'];
                  if (!validTypes.includes(file.type)) {
                    toast.error('Please upload a valid image file (PNG, JPG, or WEBP).');
                    return;
                  }
                  const url = URL.createObjectURL(file);
                  loadAndSetWatermarkImg(url, true);
                  toast.success('Watermark added successfully');
                }
              };
              input.click();
            },
          }}
          tabsIds={[TABS]}
          defaultTabId={TABS.WATERMARK}
          defaultToolId={TOOLS.TEXT}
          translations={{
            profile: 'Profile',
            coverPhoto: 'Cover Photo',
            facebook: 'Facebook',
            socialMedia: 'Social Media',
            fbProfileSize: '180x180px',
            fbCoverPhotoSize: '820x312px',
          }}
          closeAfterSave={true}
          defaultSavedImageType="png"
          defaultSavedImageQuality={0.92}
          theme={{
            palette: {
              'bg-primary': '#0D0D0D50',
              'bg-secondary': '#0D0D0D50',
              'bg-primary-active': '#22222250',

              'accent-primary': 'oklch(0.279 0.041 260.031)',
              'accent-primary-active': 'oklch(0.279 0.041 260.031)',

              'icons-primary': '#ffffff',
              'icons-secondary': '#ffffff',

              'borders-primary': 'oklch(1 0 0 / 10%)',
              'borders-secondary': 'oklch(1 0 0 / 10%)',
              'borders-strong': 'oklch(1 0 0 / 10%)',

              'light-shadow': '',

              warning: '#FFB74D',
              success: '#66BB6A',
              error: 'oklch(0.704 0.191 22.216)',

              'text-primary': 'oklch(0.984 0.003 247.858)',
              'text-secondary': 'oklch(0.704 0.04 256.788)',
            },
            typography: {
              fontFamily: 'Public Sans, Arial, sans-serif',
            },
          }}
        />
      )}
    </div>
  );
}

// Text={{
//   text: 'Filerobot...',
//   fontFamily: 'Public Sans',
//   fonts: [
//     { label: 'Public Sans', value: 'Public Sans' },
//     { label: 'Roboto', value: 'Roboto' },
//     { label: 'Montserrat', value: 'Montserrat' },
//     { label: 'Open Sans', value: 'Open Sans' },
//     { label: 'Lato', value: 'Lato' },
//     { label: 'Poppins', value: 'Poppins' },
//     { label: 'Nunito', value: 'Nunito' },
//     { label: 'Raleway', value: 'Raleway' },
//     { label: 'Playfair Display', value: 'Playfair Display' },
//     { label: 'Merriweather', value: 'Merriweather' },
//     { label: 'Oswald', value: 'Oswald' },
//     { label: 'Ubuntu', value: 'Ubuntu' },
//     { label: 'Source Sans Pro', value: 'Source Sans Pro' },
//     { label: 'Work Sans', value: 'Work Sans' },
//     { label: 'Rubik', value: 'Rubik' },
//     { label: 'DM Sans', value: 'DM Sans' },
//     { label: 'Inter', value: 'Inter' },
//     { label: 'Josefin Sans', value: 'Josefin Sans' },
//     { label: 'Quicksand', value: 'Quicksand' },
//     { label: 'Cabin', value: 'Cabin' },
//     { label: 'Karla', value: 'Karla' },
//     { label: 'Titillium Web', value: 'Titillium Web' },
//     { label: 'Bebas Neue', value: 'Bebas Neue' },
//     { label: 'Fira Sans', value: 'Fira Sans' },
//     { label: 'Manrope', value: 'Manrope' },
//   ],
//   fontSize: 18,
//   letterSpacing: 0.5,
//   lineHeight: 1.2,
//   align: 'left',
//   fontStyle: 'normal',
//   onFontChange: async (newFontFamily, reRenderCanvasFn) => {
//     try {
//       // Normalize the font name for Google Fonts URL
//       const formattedFont = newFontFamily.replace(/\s/g, '+');

//       // Check if already loaded
//       if (!document.querySelector(`link[data-font="${formattedFont}"]`)) {
//         const link = document.createElement('link');
//         link.href = `https://fonts.googleapis.com/css2?family=${formattedFont}:wght@400;500;600;700&display=swap`;
//         link.rel = 'stylesheet';
//         link.setAttribute('data-font', formattedFont);
//         document.head.appendChild(link);
//       }

//       // Wait for the font to load using FontFaceSet API
//       if (document.fonts) {
//         await document.fonts.load(`16px "${newFontFamily}"`);
//       }

//       // Re-render canvas so new font applies
//       reRenderCanvasFn();
//     } catch (error) {
//       console.error(`Failed to load font: ${newFontFamily}`, error);
//       reRenderCanvasFn();
//     }
//   },
// }}
