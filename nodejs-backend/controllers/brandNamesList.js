const brandNameLists = require("../Module/brandNames/brandNamesSchema");
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require("../storage/s3");
const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require("stream");
const Campaign = require("../Module/adFactory/adFactory");
const { FailResp } = require("./responses/response");

const AWS_IMAGE_VIEW_URL = process.env.AWS_IMAGE_VIEW_URL;
const UPLOAD_TO_S3 = process.env.UPLOAD_TO_S3 === 'true';
const NAS_UPLOAD_URL = `${process.env.NEW_NAS_UPLOAD_URL}/ads-gpt-download`;

// Helper to Upload File to S3 or NAS
const uploadToS3 = async (userId, brandId, fileBase64, type) => {
  if (!fileBase64) return null;
  const matches = fileBase64.match(
  /^(?:data:image\/[a-zA-Z0-9.+-]+;base64,(.+)|https:\/\/.+\.(png|jpe?g|gif|webp|ico))$/i
);

  if (!matches) throw new Error('Invalid base64 format');

  const buffer = Buffer.from(matches[1], "base64");

  const stream = Readable.from(buffer);
  const fileExtension = type === 'icon' ? fileBase64.includes('jpeg') ? 'jpeg' : 'png' : 'png';
  const folder = type === 'logo' ? 'logos' : type === 'icon' ? 'icons' : 'productimages';
  const timestamp = Date.now();
  // const key = `mybrands/${userId}/${folder}/${brandId}`;
  const fileName = `${timestamp}-${uuidv4()}.${fileExtension}`;
  const key = `mybrands/${userId}/${folder}/${brandId}/${fileName}`;

  if (UPLOAD_TO_S3) {
    // Upload to AWS S3
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: `image/${fileExtension}`,
    });

    await s3Client.send(command);
    return `/${key}`;
  } else {
    // Upload to NAS
    const formData = new FormData();
    formData.append('file', stream, {
      filename: `${timestamp}.${fileExtension}`,
      contentType: `image/${fileExtension}`,
    });
    formData.append('type', 'IMAGE');
    formData.append('userId', key);
    formData.append('download', 'false');

    try {
      const response = await axios.post(NAS_UPLOAD_URL, formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });

      if (response.data.code === 200 && response.data.data) {
        return response.data.data; // Return the file path from NAS
      } else {
        throw new Error('NAS upload failed');
      }
    } catch (err) {
      console.error('Error uploading to NAS:', err);
      throw new Error('Failed to upload to NAS');
    }
  }
};

const deleteFromS3 = async (key) => {
  if (!key) return;

  try {
    if (UPLOAD_TO_S3) {
      // Delete from AWS S3
      const command = new DeleteObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: key,
      });
      await s3Client.send(command);
    } else {
      // Delete from NAS
      await axios.delete(`${process.env.NEW_NAS_UPLOAD_URL}/delete/${key}`);
    }
  } catch (err) {
    console.error(`Failed to delete object ${key}:`, err);
  }
};

// Get all the brand names
const getBrandNames = async (req, res) => {
  const { userId } = req.query;
  const skip = parseInt(req.query.skip) || 0;
  const limit = parseInt(req.query.limit) || 10;

  try {
    const user = await brandNameLists.findOne({ user_id: userId });
    if (!user) return res.status(404).json({ message: 'User name not found' });

    const sortedBrands = user.brands
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(skip, skip + limit);

    const brandNames = sortedBrands.map(brand => ({
      id: brand.brandId,
      name: brand.brandName
    }));

    res.json(brandNames);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all the brand list
const getBrandsList = async (req, res) => {
  const { userId } = req.query;
  const skip = parseInt(req.query.skip) || 0;
  const limit = parseInt(req.query.limit) || 10;

  try {
    const user = await brandNameLists.findOne({ user_id: userId }).lean();
    if (!user) return res.status(404).json({ message: 'Brand name lists not found' });

    const sortedBrands = user.brands
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(skip, skip + limit);

    
    const allCampaignIds = [
      ...new Set(
        sortedBrands.flatMap(b => b.campaignIds || [])
      )
    ];

    const campaigns = allCampaignIds.length
      ? await Campaign.find(
          { _id: { $in: allCampaignIds }, userId },
          { _id: 1, "metadata.campaignName": 1 }
        ).lean()
      : [];

    const campaignMap = {};
    campaigns.forEach(c => {
      campaignMap[c._id.toString()] = c.metadata?.campaignName || "";
    });

    const response = sortedBrands.map(brand => ({
      id: brand.id,
      name: brand.brandName,
      description: brand.brandDescription,
      logoUrls: brand.logoUrls ? brand.logoUrls.map(url => `${AWS_IMAGE_VIEW_URL}${url}`) : [],
      iconUrl: brand.iconUrl ? `${AWS_IMAGE_VIEW_URL}${brand.iconUrl}` : '',
      instagramUrl: brand?.instagramUrl,
      facebookUrl: brand?.facebookUrl,
      linkedinUrl: brand?.linkedinUrl,
      websiteUrl: brand?.websiteUrl,

      imageUrl: (brand?.imageUrls || []).map(
        url => `${AWS_IMAGE_VIEW_URL}${url}`
      ),

      region: brand.region || null,
      targetAudiences: brand.targetAudiences || [],
      createdAt: brand.createdAt,

      campaignCount: brand.campaignIds?.length || 0,

      campaigns: (brand.campaignIds || []).map(cid => ({
        campaignId: cid,
        campaignName: campaignMap[cid],
      })),
    }));

    return res.status(200).json(response);
  } catch (err) {
    console.error("getBrandsList error:", err);
    return res.status(500).json({ error: err.message });
  }
};

const migrateLogoUrlToLogoUrls = async (userId) => {
  const user = await brandNameLists.findOne({ user_id: userId });
  if (!user) return;

  let modified = false;

  const updatedBrands = user.brands.map((brandDoc) => {
    const brand = brandDoc.toObject();

    if (brand.logoUrl && typeof brand.logoUrl === 'string' && brand.logoUrl.trim() !== '') {
      if (!Array.isArray(brand.logoUrls)) {
        brand.logoUrls = [];
      }

      if (!brand.logoUrls.includes(brand.logoUrl)) {
        brand.logoUrls.push(brand.logoUrl);
      }

      delete brand.logoUrl;
      modified = true;
    }

    return brand;
  });

  if (modified) {
    user.set('brands', updatedBrands);
    user.markModified('brands');
    await user.save();
  }
};

const updateBrandsList = async (req, res) => {
  const {
    userId,
    id,
    brandName,
    brandDescription,
    logoBase64s,
    iconBase64,
    imageBase64,
    websiteUrl,
    instagramUrl,
    facebookUrl,
    linkedinUrl,
    region,
    targetAudiences,
  } = req.body;

  if (!userId || !id || !brandName || !websiteUrl) {
    return res.status(400).json({ message: 'Missing required fields: userId, id, brandName, websiteUrl' });
  }

  try {
    const user = await brandNameLists.findOne({ user_id: userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const brandIndex = user.brands.findIndex((b) => b.id === id);
    if (brandIndex === -1) {
      return res.status(404).json({ message: 'Brand not found' });
    }

    const brand = user.brands[brandIndex];

    if (brandName !== brand.brandName) {
      const exists = await brandNameLists.findOne({
        user_id: userId,
        'brands.brandName': brandName,
        'brands.id': { $ne: id },
      });
      if (exists) {
        return res.status(409).json({ message: 'Brand name already exists for this user' });
      }
      brand.brandName = brandName;
    }

    brand.brandDescription = brandDescription !== undefined ? brandDescription : brand.brandDescription || '';
    brand.region = region !== undefined ? (region || null) : brand.region ?? null;
    brand.targetAudiences = targetAudiences !== undefined ? (targetAudiences || []) : brand.targetAudiences ?? [];
    const oldLogoUrls = brand.logoUrls || [];
    const oldIconUrl = brand.iconUrl;
    const oldImageUrls = brand.imageUrls || [];
    brand.websiteUrl = websiteUrl;
    brand.instagramUrl = instagramUrl || '';
    brand.facebookUrl = facebookUrl || '';
    brand.linkedinUrl = linkedinUrl || '';

    if (logoBase64s !== undefined && Array.isArray(logoBase64s)) {
      const newLogoUrls = [];
      for (const logoBase64 of logoBase64s) {
        if (logoBase64.includes('https://')) {
          const existingUrl = logoBase64.replace(AWS_IMAGE_VIEW_URL, '');
          if (!newLogoUrls.includes(existingUrl)) {
            newLogoUrls.push(existingUrl);
          }
        } else if (logoBase64 !== '') {
          const newLogoUrl = await uploadToS3(userId, id, logoBase64, 'logo');
          if (newLogoUrl) {
            newLogoUrls.push(newLogoUrl);
          }
        }
      }
      brand.logoUrls = [...newLogoUrls, ...oldLogoUrls.filter(url => !logoBase64s.includes(`${AWS_IMAGE_VIEW_URL}${url}`))];
    }

    if (iconBase64 !== undefined) {
      if (iconBase64.includes('https://')) {
        brand.iconUrl = brand.iconUrl || '';
      } else if (iconBase64 !== '') {
        if (oldIconUrl) {
          await deleteFromS3(oldIconUrl);
        }
        const newIconUrl = await uploadToS3(userId, id, iconBase64, 'icon');
        if (!newIconUrl) {
          return res.status(400).json({ message: 'Failed to upload icon or invalid icon provided' });
        }
        brand.iconUrl = newIconUrl;
      } else {
        if (oldIconUrl) {
          await deleteFromS3(oldIconUrl);
        }
        brand.iconUrl = '';
      }
    }

    //  const oldImageUrls = brand.imageUrls || [];

    if (imageBase64 !== undefined && Array.isArray(imageBase64)) {
      const newImageUrls = [];
      for (const image of imageBase64) {
        if (image.includes('https://')) {
          const existingUrl = image.replace(AWS_IMAGE_VIEW_URL, '');
          if (!newImageUrls.includes(existingUrl)) {
            newImageUrls.push(existingUrl);
          }
        } else if (image !== '') {
          const newImageUrl = await uploadToS3(userId, id, image, 'image');
          if (newImageUrl) {
            newImageUrls.push(newImageUrl);
          }
        }
      }
      brand.imageUrls = [
        ...newImageUrls,
        ...oldImageUrls.filter(url => !imageBase64.includes(`${AWS_IMAGE_VIEW_URL}${url}`))
      ];
    }
    await user.save({ validateBeforeSave: true });

    res.status(200).json({
      message: 'Brand updated successfully',
      brand: {
        id: brand.id,
        brandName: brand.brandName,
        brandDescription: brand.brandDescription,
        logoUrls: brand.logoUrls ? brand.logoUrls.map(url => `${process.env.AWS_IMAGE_VIEW_URL}${url}`) : [],
        iconUrl: brand.iconUrl ? `${process.env.AWS_IMAGE_VIEW_URL}${brand.iconUrl}` : '',
        // imageUrl: brand.imageUrl ? `${process.env.AWS_IMAGE_VIEW_URL}${brand.imageUrl}` : '',
        imageUrl: brand.imageUrls ? brand.imageUrls.map(url => `${process.env.AWS_IMAGE_VIEW_URL}${url}`) : [],
        websiteUrl: brand.websiteUrl,
        instagramUrl: brand.instagramUrl,
        facebookUrl: brand.facebookUrl,
        linkedinUrl: brand.linkedinUrl,
        region: brand.region || null,
        targetAudiences: brand.targetAudiences || [],
      },
    });
  } catch (err) {
    console.error('Error in updateBrandsList:', {
      message: err.message,
      stack: err.stack,
      userId,
      brandId: id,
      brandName,
      brandDescription,
    });
    res.status(500).json({ error: err.message || 'Failed to update brand' });
  }
};

const createBrands = async (req, res) => {
  const {
    userId,
    userName,
    brandName,
    brandDescription,
    logoBase64s,
    iconBase64,
    imageBase64,
    websiteUrl,
    instagramUrl,
    facebookUrl,
    linkedinUrl,
    region,
    targetAudiences,
  } = req.body;

  if (!userId || !brandName || !websiteUrl) {
    return res.status(400).json({ message: 'Missing required fields: userId, brandName, websiteUrl' });
  }

  try {
    
    const exists = await brandNameLists.findOne({
      user_id: userId,
      'brands.brandName': brandName,
    });
    if (exists) {
      return res.status(409).json({ message: 'Brand name already exists for this user' });
    }

    const brandId = uuidv4();

    const logoUrls = Array.isArray(logoBase64s)
      ? await Promise.all(logoBase64s.filter(Boolean).map(b64 => uploadToS3(userId, brandId, b64, 'logo')))
      : [];

    const imageUrls = Array.isArray(imageBase64)
      ? await Promise.all(imageBase64.filter(Boolean).map(b64 => uploadToS3(userId, brandId, b64, 'image')))
      : [];
    const iconUrl = iconBase64 ? await uploadToS3(userId, brandId, iconBase64, 'icon') : '';
    // const imageUrl = imageBase64 ? await uploadToS3(userId, brandId, imageBase64, 'image') : '';

    const user = await brandNameLists.findOneAndUpdate(
      { user_id: userId },
      {
        $setOnInsert: { user_id: userId, user_name: userName || '' },
        $push: {
          brands: {
            id: brandId,
            brandName,
            brandDescription: brandDescription || '',
            logoUrls,
            iconUrl,
            imageUrls,
            websiteUrl,
            instagramUrl: instagramUrl || "",
            facebookUrl: facebookUrl || "",
            linkedinUrl: linkedinUrl || "",
            region: region || null,
            targetAudiences: targetAudiences || [],
            campaignIds: [],
            createdAt: new Date(),
          },
        },
      },
      { upsert: true, new: true }
    );

    const newBrand = user.brands.find((b) => b.id === brandId);

    res.status(201).json({
      message: 'Brand added successfully',
      data: {
        id: newBrand.id,
        brandName: newBrand.brandName,
        brandDescription: newBrand.brandDescription,
        logoUrls: newBrand.logoUrls ? newBrand.logoUrls.map(url => `${AWS_IMAGE_VIEW_URL}${url}`) : [],
        iconUrl: newBrand.iconUrl ? `${AWS_IMAGE_VIEW_URL}${newBrand.iconUrl}` : '',
        // imageUrl: newBrand.imageUrl ? `${AWS_IMAGE_VIEW_URL}${newBrand.imageUrl}` : '',
        imageUrl: newBrand.imageUrls ? newBrand.imageUrls.map(url => `${AWS_IMAGE_VIEW_URL}${url}`) : [],
        websiteUrl: newBrand.websiteUrl,
        instagramUrl: newBrand.instagramUrl,
        facebookUrl: newBrand.facebookUrl,
        linkedinUrl: newBrand.linkedinUrl,
        region: newBrand.region || null,
        targetAudiences: newBrand.targetAudiences || [],
        campaignIds: [],
      },
    });
  } catch (err) {
    console.error('Error in createBrands:', err);
    res.status(500).json({ error: err.message || 'Failed to create brand' });
  }
};


const deleteBrand = async (req, res) => {
  const { userId, id: brandId, consent = false} = req.body;

  if (!userId || !brandId) {
    return res.status(400).json({
      message: "Missing userId or brandId",
    });
  }

  try {
    const user = await brandNameLists.findOne({ user_id: userId }).lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const brand = user.brands.find(b => b.id === brandId);
    if (!brand) {
      return res.status(404).json({ message: "Brand not found" });
    }

    const campaignIds = brand.campaignIds || [];

    //  CONSENT-GATED CAMPAIGN DELETION
    if (consent === true && campaignIds.length) {
      for (const campaignId of campaignIds) {
        try {
          await axios.delete(
            `${process.env.SOCKET_URL}/adsgpt/campaign/delete/${userId}/${campaignId}`,
            {
              headers: {
                Authorization: req.headers.authorization,
              },
              timeout: 10000,
            }
          );
        } catch (err) {
        }
      }
    }

    const filesToDelete = [
      ...(brand.logoUrls || []),
      ...(brand.imageUrls || []),
      ...(brand.iconUrl ? [brand.iconUrl] : []),
    ];

    //  BRAND ALWAYS GETS DELETED
    await brandNameLists.updateOne(
      { user_id: userId },
      { $pull: { brands: { id: brandId } } }
    );

    res.status(200).json({
      message: consent
        ? "Brand and related campaigns deleted successfully"
        : "Brand deleted successfully. Campaigns retained.",
      deletedCampaigns: consent ? campaignIds.length : 0,
      consentApplied: consent,
    });

    //  NON-BLOCKING FILE CLEANUP
    Promise.allSettled(
      filesToDelete.map(key => deleteFromS3(key))
    ).catch(err => {
      console.error("Async cleanup failed:", err);
    });

  } catch (err) {
    console.error("Error in deleteBrand:", err);
    res.status(500).json({ message: "Failed to delete brand" });
  }
};



const removeBrandLogo = async (req, res) => {
  const { userId, brandId, fileUrl, type } = req.body;

  if (!userId || !brandId || !fileUrl || !['logo', 'image'].includes(type)) {
    return res.status(400).json({ message: 'Missing or invalid required fields: userId, brandId, fileUrl, type ("logo" or "image")' });
  }

  try {
    const user = await brandNameLists.findOne({ user_id: userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const brand = user.brands.find((b) => b.id === brandId);
    if (!brand) {
      return res.status(404).json({ message: 'Brand not found' });
    }

    const key = fileUrl.replace(AWS_IMAGE_VIEW_URL, '');
    const urlsArray = type === 'logo' ? brand.logoUrls : brand.imageUrls;

    if (!urlsArray?.includes(key)) {
      return res.status(404).json({ message: `${type.charAt(0).toUpperCase() + type.slice(1)} not found for this brand` });
    }

    await deleteFromS3(key);

    if (type === 'logo') {
      brand.logoUrls = urlsArray.filter(url => url !== key);
    } else {
      brand.imageUrls = urlsArray.filter(url => url !== key);
    }

    await user.save({ validateBeforeSave: true });

    res.status(200).json({
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} removed successfully`,
      brand: {
        id: brand.id,
        brandName: brand.brandName,
        brandDescription: brand.brandDescription,
        logoUrls: brand.logoUrls?.map(url => `${AWS_IMAGE_VIEW_URL}${url}`),
        iconUrl: brand.iconUrl ? `${AWS_IMAGE_VIEW_URL}${brand.iconUrl}` : '',
        imageUrl: brand.imageUrls?.map(url => `${AWS_IMAGE_VIEW_URL}${url}`),
        websiteUrl: brand.websiteUrl,
        instagramUrl: brand.instagramUrl,
        facebookUrl: brand.facebookUrl,
        linkedinUrl: brand.linkedinUrl,
      },
    });
  } catch (err) {
    console.error('Error in removeBrandFile:', err);
    res.status(500).json({ error: err.message || `Failed to remove ${type}` });
  }
};


const totalCount = async (req, res) => {
  try {
    const { userId } = req.query;
    const user = await brandNameLists.findOne({ user_id: userId });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      userId,
      totalBrands: user.brands.length
    });
  } catch (error) {
    console.error("Error fetching user's brand count:", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
};

const searchBrandsByName = async (req, res) => {
  try {
    const { user_id: userId, term: searchTerm } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing user_id',
        data: [],
      });
    }

    if (!searchTerm || typeof searchTerm !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or missing search term',
        data: [],
      });
    }
    const searchRegex = new RegExp(searchTerm, 'i');

    const result = await brandNameLists.aggregate([
      { $match: { user_id: userId } },
      {
        $project: {
          brands: {
            $filter: {
              input: '$brands',
              as: 'brand',
              cond: {
                $regexMatch: {
                  input: '$$brand.brandName',
                  regex: searchRegex
                }
              }
            }
          }
        }
      }
    ]);

    if (!result.length || !result[0].brands || result[0].brands.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'No matching brands found',
        data: [],
      });
    }

    const modifiedBrands = result[0].brands.map((brand) => ({
      ...brand,
      logoUrls: brand.logoUrls ? brand.logoUrls.map(url => `${AWS_IMAGE_VIEW_URL}${url}`) : [],
      iconUrl: brand.iconUrl ? `${AWS_IMAGE_VIEW_URL}${brand.iconUrl}` : '',
    }));

    return res.status(200).json({
      success: true,
      message: 'Brands found successfully',
      data: modifiedBrands,
    });
  } catch (error) {
    console.error('Error in searchBrandsByName:', error);
    return res.status(500).json({
      success: false,
      message: `Error searching for brands: ${error.message}`,
      data: [],
    });
  }
};

module.exports = {
  getBrandNames,
  getBrandsList,
  updateBrandsList,
  createBrands,
  deleteBrand,
  removeBrandLogo,
  totalCount,
  searchBrandsByName
};