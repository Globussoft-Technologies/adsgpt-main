const { response } = require('express');
const client = require("../DB/connect");
const { logger } = require('./Loggers/logs');
require("dotenv").config();

// const transformResponse2 = async(response) => {
//     const temp =  await response.map(hit => {
//         const source = hit?._source;
//         return {
//             id: source?.id,
//             network: source?.network,
//             adType: source?.adType?.toUpperCase() || "",  // Default to empty string if not present
//             postOwner: source?.postOwner || "",  // Default to empty string if not present
//             postOwnerImage: source?.postOwnerImage ?  (source?.postOwnerImage==="/DefaultImage.jpg" || source?.postOwnerImage==="DefaultImage.jpg") ?  source?.postOwnerImage :  (source?.network?.toLowerCase() == "facebook" || source?.network?.toLowerCase() == "youtube" || source?.network?.toLowerCase() == "")? "https://media.poweradspy.com/"+ source?.postOwnerImage :"https://contents.poweradspy.com/"+ source?.postOwnerImage:  "",  // Default to empty string if not present
//             postImage:  source?.mediaUrl?.includes('pas')?  (source?.network?.toLowerCase() == "facebook" || source?.network?.toLowerCase() == "youtube" || source?.network?.toLowerCase() == "")?  "https://media.poweradspy.com/"+source?.mediaUrl : "https://contents.poweradspy.com/"+source?.mediaUrl: source?.mediaUrl || "",  // Default to empty string if not present
//             adUrl: source?.adUrl || null,  // Default to null if not present
//             description: source?.adText || "",  // Default to empty string if not present
//             adTitle: source?.adTitle || "",
//             newsfeedDescription: source?.newsfeedDescription || "",
//             open_in_pas: `https://app-dev.poweradspy.com/${source?.network?? ""}/getAdDetails/` + source?.id || "",  // Default to empty string if not present
//             // Add other fields here if necessary
//         };
//     });
//     return temp 
// };

const transformResponse = async(response) => {
    const temp =  await response.hits.hits.map(hit => {
        const source = hit?._source;
        return {
            id: source?.id,
            network: source?.network,
            adType: source?.adType?.toUpperCase() || "",  // Default to empty string if not present
            postOwner: source?.postOwner || "",  // Default to empty string if not present
            postOwnerImage: source?.postOwnerImage ?  (source?.postOwnerImage==="/DefaultImage.jpg" || source?.postOwnerImage==="DefaultImage.jpg") ? source?.postOwnerImage : process.env.MEDIA_URL+ source?.postOwnerImage:  "",  // Default to empty string if not present
            postImage:  source?.mediaUrl?.includes('pas')? process.env.MEDIA_URL+source?.mediaUrl : source?.mediaUrl || "",  // Default to empty string if not present
            adUrl: source?.adUrl || null,  // Default to null if not present
            description: source?.adText || "",  // Default to empty string if not present
            adTitle: source?.adTitle || "",
            newsfeedDescription: source?.newsfeedDescription || "",
            open_in_pas: `${process.env.DEV_URL}${source?.network?? ""}/getAdDetails/` + source?.id || "",  // Default to empty string if not present
            popularityIndex: source?.popularityIndex || "",
        };
    });
    return temp 
};


exports.getScrollData = async (req, res) => {
    const { skip = 0, limit = 10, network = [], postOwner = [], currentContext = [] } = req.body;
    let defaultQuery = null;
    if (network.length === 0 && postOwner.length === 0 && currentContext.length === 0) {
        defaultQuery = {
            index: 'devadsgpt_ads_data_2',
            from: skip ?? 20,
            size: limit ?? 20,
            body: {
                query: {
                    match_all: {}
                },
                sort: [
                    {popularityIndex: { order: "desc" }},
                    { lastSeen: { order: 'desc' } }
                ]
            }
        };
    }

    const shouldClauses = [];
    let networkOrder = null;
    let sortBy  = 'network'
    
     if (postOwner?.length > 0) {
        shouldClauses.push({ "terms": { "postOwner": postOwner.reverse()} });
        networkOrder = {};
        sortBy = 'postOwner'
        postOwner.forEach((element, index) => {
            networkOrder[element] = index;
        });
    }
  
   else if (network?.length > 0) {
        shouldClauses.push({ "terms": { "network": network.reverse() } });
        networkOrder = {};
        sortBy = 'network'
        network.forEach((element, index) => {
            networkOrder[element] = index;
        });
    }
    else if (currentContext?.length > 0) {
        shouldClauses.push({ "terms": { "category": currentContext.reverse() } });
        networkOrder = {};
        sortBy = 'category'
        currentContext.forEach((element, index) => {
            networkOrder[element] = index;
        });
    }


    const searchParams = defaultQuery ? defaultQuery : {
        index: 'devadsgpt_ads_data_2',
        from: skip ?? 0,
        size: limit ?? 20,
        body: {
            query: {
                bool: {
                    should: shouldClauses,
                    minimum_should_match: 1
                }
            },
            sort: [
                {
                    _script: {
                        type: 'number',
                        script: {
                            lang: 'painless',
                            source: `
                                def order = params.order;
                                def network = doc['${sortBy}'].value;
                                return order.containsKey(network) ? order[network] : order.size();
                            `,
                            params: {
                                order: networkOrder ? networkOrder : {}
                            }
                        },
                        order: 'desc'
                    }
                },
                {popularityIndex: { order: "desc" }},
                { lastSeen: { order: 'desc' } }
            ]
        }
    };

    try {
        const response = await client.search(searchParams);

        const processAds = await transformResponse(response);
        const responseObject = {
            "code": 200,
            "adsData": {
                "overallCount": response?.hits?.total?.value,
                "context": currentContext,
                "network": network,
                "postOwner": postOwner,
                "adsData": processAds
            }
        };

        res.json(responseObject);
    } catch (error) {
        logger.error('Elasticsearch search query failed', { error });
        res.status(500).json({
            "code": 500,
            message: 'Internal Server Error',
            "adsData": {
                "overallCount": 0,
                "context": currentContext,
                "network": network,
                "postOwner": postOwner,
                "adsData": []
            }
        });
    }
};



// exports.getScrollData2 = async (req, res) => {
//     let limit = req?.body?.limit || 10;
//     let skip = req?.body?.skip || 0;
//     let payload = req.body.myner;
//     payload.uid = req?.body?.uid;
//     payload.chatId = req?.body?.chatId;
//     payload.sessionId = req.body.sessionId;
    
//     // Initialize empty query
//     let query = { bool: { filter: [] } };    
//     // Create dynamic query
//     Object.keys(payload).forEach((key) => {
//         if (Array.isArray(payload[key]) && payload[key].length > 0) {
//             const filterQuery = 
//                 payload[key].length > 1
//                     ? { terms: { [key]: payload[key] } }
//                     : { term: { [key]: payload[key][0] } };
//             query.bool.filter.push(filterQuery);
//         }
//     });

//     // Modify the query to match_all if the above query is empty
//     if (query.bool.filter.length === 0) query = { match_all: {} };

//     try {
//         // Elasticsearch search request with from and size parameters
//         let response = await client.search({
//             index: 'devadsgpt_ads_data_2',
//             body: {
//                 query,
//                 _source: [
//                     "id",
//                     "network",
//                     "postOwner",
//                     "postOwnerImage",
//                     "mediaUrl",
//                     "newsfeedDescription",
//                     "adUrl",
//                     "category",
//                     "network",
//                     "adTitle",
//                     "adType",
//                 ],
//                 from: skip, // Skip the first `skip` documents
//                 size: limit, // Limit the number of documents returned
//             }
//         });

//         const overallCount = response?.hits?.total?.value;
//         let hits = response.hits.hits;
//         let data = hits.map((hit) => hit._source);

//         const processAds = await transformResponse2(hits);
//         const responseObject = {
//             "code": 200,
//             "adsData": {
//                 "uid": req?.body?.uid,
//                 "chatId": req?.body?.chatId,
//                 "sessionId": req.body.sessionId,
//                 "overallCount": overallCount,
//                 "adsData": processAds
//             }
//         };

//         res.json(responseObject);

//     } catch (error) {
//         console.error("Error:", error);
//         logger.error(error.stack);
//         res.status(500).json({ error: error.message });
//     }
// };
