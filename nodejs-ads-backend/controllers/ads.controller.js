require("dotenv").config();
const {
  adsDataPayloadFormat,
  formattedResponse,
} = require("../utils/adsHandler");
const {
  getAdsES,
  getFresUserAds,
  getVectorSearchAds,
  getAdvertiserAds,
  fetchExploreAds
} = require("../utils/elasticsearch");
const {
  sendBadRequestResponse,
  sendSuccessResponse,
} = require("../utils/response");
const { nerPayloadValidator } = require("../utils/validator");
const logger = require("./Loggers/logs");
const { pub } = require("../utils/pubSubHandler");

exports.getAdsData = async (req, res) => {
  try {
    const start = performance.now();
    const nerPayload = req.body;

    logger.info(
      `Received from chatbot for initial ads - ${JSON.stringify(nerPayload)}`
    );
    // Validate the payload
    const { error, value } = nerPayloadValidator(nerPayload);
    if (error) {
      logger.error(
        `Validation error in getAds controller ${JSON.stringify(error.details)}`
      );
      return sendBadRequestResponse(res, error.details);
    }
    const { uid, chatId, sessionId, skip } = value;
    if (skip === 0) pub.publish("currentContext", JSON.stringify(nerPayload));
    if (nerPayload?.isFreshUser === true) {
      const esData = await getFresUserAds(skip);
      if (!esData || esData.length === 0) {
        const response = formattedResponse(
          uid,
          chatId,
          sessionId,
          "adsStatus",
          false,
          esData,
          performance.now(),
          start
        );
        return sendSuccessResponse(res, response);
      }
      if (skip > 0)
        return sendSuccessResponse(res, {
          adsData: { adsData: esData, overallCount: 10000 },
        });
      const data = adsDataPayloadFormat(uid, chatId, sessionId, esData);
      pub.publish(process.env.ADS_DATA, JSON.stringify(data));
      logger.info(
        `Published ads data to ${
          process.env.ADS_DATA
        } channel - ${JSON.stringify(data)}`
      );
      return sendSuccessResponse(res, data);
    }

    let ids = [];
    if (
      value?.advertiser_payloads &&
      Array.isArray(value?.advertiser_payloads) &&
      value?.advertiser_payloads.length > 0
    ) {
      value?.advertiser_payloads.map((id) => ids.push(id));
    }
    if (
      value?.normal_payloads &&
      Array.isArray(value?.normal_payloads) &&
      value?.normal_payloads.length > 0
    ) {
      value?.normal_payloads.map((id) => ids.push(id));
    }
    ids = Array.from(new Set(ids));

    const payload = {
      postOwner: value?.postOwner || [],
      network: value?.network || [],
    };

    const vectorSkip = skip / 10;
    const esData = await getAdsES(payload, ids, skip, vectorSkip);

    if (!esData || esData.length === 0) {
      const response = formattedResponse(
        uid,
        chatId,
        sessionId,
        "adsStatus",
        false,
        esData,
        performance.now(),
        start
      );
      return sendSuccessResponse(res, response);
    }

    if (skip > 0)
      return sendSuccessResponse(res, {
        adsData: { adsData: esData, overallCount: 10000 },
      });
    const data = adsDataPayloadFormat(uid, chatId, sessionId, esData);

    // Publish the data
    if (esData && Array.isArray(esData) && esData.length > 0) {
      pub.publish(process.env.ADS_DATA, JSON.stringify(data));
      logger.info(
        `Published initial ads data to ${
          process.env.ADS_DATA
        } channel - ${JSON.stringify(data)}`
      );
    } else {
      logger.info("No ads found");
    }

    const end = performance.now();

    const response = formattedResponse(
      uid,
      chatId,
      sessionId,
      "adsStatus",
      true,
      data,
      end,
      start
    );

    logger.info("Sent initial ads data.");
    return sendSuccessResponse(res, response);
  } catch (error) {
    logger.error(error);
  }
};

exports.getVectorAdsData = async (req, res) => {
  /* #swagger.tags = ['Ads']
                           #swagger.description = 'This route is used to get ads data.' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Ads data',
                                required: true,
                                schema: { $ref: "#/definitions/Ads" }
                        } */
    /*  #swagger.responses[200] = {
        description:'Found ads data'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing request data | Validation failed'
      }
    */
  try {
    const start = performance.now();
    const nerPayload = req.body;
    
    logger.info(
      `Received from chatbot for initial ads - ${JSON.stringify(nerPayload)}`
    );
    // Validate the payload
    const { error, value } = nerPayloadValidator(nerPayload);
    
    if (error) {
      logger.error(
        `Validation error in getAds controller ${JSON.stringify(error.details)}`
      );
      return sendBadRequestResponse(res, error.details);
    }
    const { uid, chatId, sessionId, skip, isAdvertiserChat, token, featureObject, socket_id } = value;

    // For plan restriction
    const planBasedNetworks = featureObject["Networks"] || [];
    const showPopularity = featureObject["Popularity Index"];

    // Publish the context to frontend for ad scrolling
    if (skip === 0) pub.publish("currentContext", JSON.stringify(nerPayload));

    // For advertiser search
    if (isAdvertiserChat === true) {
      const payload = { postOwner: value?.postOwner || [] };
      const esData = await getAdvertiserAds(payload, skip, planBasedNetworks, showPopularity);
      if (!esData || esData.length === 0) {
        const response = formattedResponse(
          uid,
          chatId,
          sessionId,
          "adsStatus",
          false,
          esData,
          performance.now(),
          start
        );
        return sendSuccessResponse(res, response);
      }
      if (skip > 0)
        return sendSuccessResponse(res, {
          adsData: { adsData: esData, overallCount: 10000, token },
        });
      const data = adsDataPayloadFormat(uid, chatId, sessionId, esData, token, socket_id);
      pub.publish(process.env.ADS_DATA, JSON.stringify(data));
      logger.info(
        `Published ads data to ${
          process.env.ADS_DATA
        } channel - ${JSON.stringify(data)}`
      );
      return sendSuccessResponse(res, data);
    }

    // For fresh user
    if (nerPayload?.isFreshUser === true) {
      const esData = await getFresUserAds(skip, planBasedNetworks, showPopularity);
      if (!esData || esData.length === 0) {
        const response = formattedResponse(
          uid,
          chatId,
          sessionId,
          "adsStatus",
          false,
          esData,
          performance.now(),
          start
        );
        return sendSuccessResponse(res, response);
      }
      if (skip > 0)
        return sendSuccessResponse(res, {
          adsData: { adsData: esData, overallCount: 10000, token },
        });
      const data = adsDataPayloadFormat(uid, chatId, sessionId, esData, token, socket_id);
      pub.publish(process.env.ADS_DATA, JSON.stringify(data));
      logger.info(
        `Published ads data to ${
          process.env.ADS_DATA
        } channel - ${JSON.stringify(data)}`
      );
      return sendSuccessResponse(res, data);
    }

    // For vectorsearch
    const payload = {
      network: value?.network || [],
      country: value?.country || [],
    };
    const embeddings = value?.user_query_embeddings || [];

    const esData = await getVectorSearchAds(payload, embeddings, skip, showPopularity, planBasedNetworks);

    if (!esData || esData.length === 0) {
      const response = formattedResponse(
        uid,
        chatId,
        sessionId,
        "adsStatus",
        false,
        esData,
        performance.now(),
        start
      );
      return sendSuccessResponse(res, response);
    }

    if (skip > 0)
      return sendSuccessResponse(res, {
        adsData: { adsData: esData, overallCount: 10000, token },
      });
    const data = adsDataPayloadFormat(uid, chatId, sessionId, esData, token, socket_id);

    // Publish the data
    if (esData && Array.isArray(esData) && esData.length > 0) {
      pub.publish(process.env.ADS_DATA, JSON.stringify(data));
      logger.info(
        `Published initial ads data to ${
          process.env.ADS_DATA
        } channel - ${JSON.stringify(data)}`
      );
    } else {
      logger.info("No ads found");
    }

    const end = performance.now();

    const response = formattedResponse(
      uid,
      chatId,
      sessionId,
      "adsStatus",
      true,
      data,
      end,
      start
    );

    logger.info("Sent initial ads data.");
    return sendSuccessResponse(res, response);
  } catch (error) {
    logger.error(error);
  }
};

// Explore ads for ad creatives
exports.getExploreAds = async (req, res) => {
  try {
    let token = req.headers['authorization'].split(" ")[1]
    const {from, size, networks, popularity, type , user_id,platform, competitor,searchType} = req.body;
    const data = await fetchExploreAds(from, size, networks, popularity, type, token , user_id,platform, competitor,searchType)
    const hasNotRelevantMessage = (arr) => arr.some(item => item?.message?.includes('This is not relevant'));
    return res.status(200).json({
      message: hasNotRelevantMessage(data) ? "This is not relevant" : "Success" ,
      status : data?.status || 0,
      ads: hasNotRelevantMessage(data) ? [] : data
    })
    // return sendSuccessResponse(res, data)
  } catch (error) {
    logger.error(error);
    return sendBadRequestResponse(res, error)
  }
}