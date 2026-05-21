const bizSdk = require("facebook-nodejs-business-sdk");
const FBUsers = require("../../Module/adPosting/facebookUsers");
const { decrypt } = require("../../utils/crypto");

class PostController {
  constructor() {
    this.createPost = this.createPost.bind(this);
    this.postWithImageFile = this.postWithImageFile.bind(this);
    this.postWithImageUrl = this.postWithImageUrl.bind(this);
    this.getUserPages = this.getUserPages.bind(this);
  }

  async getUserPages(req, res) {
    try {
      const accountId = req.params.accountId;
  
      const fbUser = await FBUsers.findById(accountId);
      if (!fbUser) {
        return res.status(404).json({ error: "Facebook user not found" });
      }
  
      const accessToken = decrypt(fbUser?.accessToken);
      if (!accessToken) {
        return res.status(401).json({ error: "Access token is required" });
      }
  
      // Init SDK
      const api = bizSdk.FacebookAdsApi.init(accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);
  
      const user = new bizSdk.User("me");
  
      let allPages = [];
  
      // =========================
      // 1. DIRECT PAGES (/me/accounts)
      // =========================
      let directPages = [];
      try {
        const accounts = await user.getAccounts([
          "id",
          "name",
          "access_token",
          "category",
          "fan_count",
          "picture",
        ]);
  
        directPages = accounts.map((account) => ({
          id: account.id,
          name: account.name,
          accessToken: account.access_token,
          category: account.category,
          fanCount: account.fan_count,
          picture: account.picture?.data?.url,
          source: "direct",
        }));
      } catch (err) {
        console.warn("Direct pages fetch failed:", err.message);
      }
  
      allPages.push(...directPages);
  
      // =========================
      // 2. BUSINESS MANAGER PAGES
      // =========================
      let businessPages = [];
  
      try {
        const businesses = await user.getBusinesses(["id", "name"]);
  
        for (const biz of businesses) {
          // Owned pages
          try {
            const ownedPages = await biz.getOwnedPages([
              "id",
              "name",
              "access_token",
              "category",
              "fan_count",
              "picture",
            ]);
  
            const mappedOwned = ownedPages.map((page) => ({
              id: page.id,
              name: page.name,
              accessToken: page.access_token,
              category: page.category,
              fanCount: page.fan_count,
              picture: page.picture?.data?.url,
              source: "business_owned",
              businessId: biz.id,
              businessName: biz.name,
            }));
  
            businessPages.push(...mappedOwned);
          } catch (err) {
            console.warn(`Owned pages failed for biz ${biz.id}`);
          }
  
          // Client pages
          try {
            const clientPages = await biz.getClientPages([
              "id",
              "name",
              "access_token",
              "category",
              "fan_count",
              "picture",
            ]);
  
            const mappedClient = clientPages.map((page) => ({
              id: page.id,
              name: page.name,
              accessToken: page.access_token,
              category: page.category,
              fanCount: page.fan_count,
              picture: page.picture?.data?.url,
              source: "business_client",
              businessId: biz.id,
              businessName: biz.name,
            }));
  
            businessPages.push(...mappedClient);
          } catch (err) {
            console.warn(`Client pages failed for biz ${biz.id}`);
          }
        }
      } catch (err) {
        console.warn("Business fetch failed:", err.message);
      }
  
      allPages.push(...businessPages);
  
      // =========================
      // 3. REMOVE DUPLICATES
      // =========================
      const uniquePagesMap = new Map();
  
      for (const page of allPages) {
        if (!uniquePagesMap.has(page.id)) {
          uniquePagesMap.set(page.id, page);
        }
      }
  
      const finalPages = Array.from(uniquePagesMap.values());
  
      // =========================
      // RESPONSE
      // =========================
      return res.json({
        pages: finalPages,
        count: finalPages.length,
        breakdown: {
          direct: directPages.length,
          business: businessPages.length,
        },
      });
  
    } catch (error) {
      console.error("Get pages error:", error.response?.data || error.message);
      return res.status(500).json({
        error: "Failed to fetch pages",
        details: error.response?.data?.error?.message || error.message,
      });
    }
  }

  /**
   * Create a post on a Facebook page with an image
   */
  async createPost(req, res) {
    try {
      const { pageId, pageAccessToken, message, imageUrl } = req.body;
      const imageFile = req.file;

      // Validation
      if (!pageId || !pageAccessToken) {
        return res.status(400).json({
          error: "Page ID and access token are required",
        });
      }

      if (!imageFile && !imageUrl) {
        return res.status(400).json({
          error: "Either image file or image URL is required",
        });
      }

      console.log("Creating post for page:", pageId);
      console.log("Message:", message);
      console.log("Has image file:", !!imageFile);
      console.log("Has image URL:", !!imageUrl);

      let postResponse;

      if (imageFile) {
        // Post with uploaded image file
        postResponse = await this.postWithImageFile(
          pageId,
          pageAccessToken,
          message,
          imageFile
        );
      } else if (imageUrl) {
        // Post with image URL
        postResponse = await this.postWithImageUrl(
          pageId,
          pageAccessToken,
          message,
          imageUrl
        );
      }

      res.json({
        success: true,
        postId: postResponse.id,
        message: "Post created successfully",
        data: postResponse,
      });
    } catch (error) {
      console.error(
        "Create post error:",
        error.response?.data || error.message
      );
      res.status(500).json({
        error: "Failed to create post",
        details: error.response?.data?.error?.message || error.message,
      });
    }
  }

  /**
   * Post with image file buffer using SDK
   */
  async postWithImageFile(pageId, pageAccessToken, message, imageFile) {
    // Initialize SDK with page token
    const api = bizSdk.FacebookAdsApi.init(pageAccessToken);
    bizSdk.FacebookAdsApi.setDefaultApi(api);

    const page = new bizSdk.Page(pageId);

    // Upload photo using SDK
    const photo = await page.createPhoto([], {
      message: message || "",
      bytes: imageFile.buffer.toString("base64"),
    });

    return { id: photo.id };
  }

  /**
   * Post with image URL using SDK
   */
  async postWithImageUrl(pageId, pageAccessToken, message, imageUrl) {
    // Initialize SDK with page token
    const api = bizSdk.FacebookAdsApi.init(pageAccessToken);
    bizSdk.FacebookAdsApi.setDefaultApi(api);

    const page = new bizSdk.Page(pageId);

    // Upload photo using SDK
    const photo = await page.createPhoto([], {
      message: message || "",
      url: imageUrl,
    });

    return { id: photo.id };
  }
}

module.exports = new PostController();
