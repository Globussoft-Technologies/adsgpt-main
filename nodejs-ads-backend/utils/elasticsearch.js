require("dotenv").config();
const client = require("../DB/connect");
const axios = require('axios')
const { processAdsAdata, processExploreAdsAdata , processExploreAdsAdataPAS} = require("./adsHandler");
const logger = require("../controllers/Loggers/logs");

const INDEX_NAME = process.env.INDEX_NAME;

exports.getAdsES = async (payload, ids, nerSkip = 0, vectorSkip = 0) => {
  try {
    let query = { bool: { filter: [] } };
    const _source = [
      "id",
      "network",
      "postOwner",
      "postOwnerImage",
      "mediaUrl",
      "newsfeedDescription",
      "adUrl",
      "category",
      "network",
      "adTitle",
      "adType",
      "adText",
      "popularityIndex",
      "embeddings_paraphase_minilm_384",
      "othermedia",
    ];
    Object.keys(payload).forEach((key) => {
      if (Array.isArray(payload[key]) && payload[key].length > 0) {
        const filterQuery =
          payload[key].length > 1
            ? { terms: { [key]: payload[key] } }
            : { term: { [key]: payload[key][0] } };
        query.bool.filter.push(filterQuery);
      }
    });
    if (query.bool.filter.length === 0) {
      query.bool.filter.push({ terms: { adsgptId: ids } });
      return await searchWithId(query, _source, vectorSkip);
    }
    let response = await client.search({
      from: nerSkip,
      size: 20,
      index: INDEX_NAME,
      body: {
        _source,
        query,
      },
    });
    let hits = response?.hits?.hits;
    let data = hits.map((hit) => hit._source);
    if (Array.isArray(data) && data.length === 0) {
      let query = { bool: { filter: [{ terms: { adsgptId: ids } }] } };
      return searchWithId(query, _source, vectorSkip);
    }
    return processAdsAdata(data);
  } catch (error) {
    // console.log(error)
    logger.error(error);
  }
};

async function searchWithId(query, _source, vectorSkip) {
  try {
    let response = await client.search({
      size: 20,
      index: INDEX_NAME,
      body: {
        _source,
        query,
      },
    });
    const queryVectors = response.hits.hits.map(
      (hit) => hit._source.embeddings_paraphase_minilm_384
    );

    if (queryVectors.length === 0) {
      return null;
    }

    _source.pop();
    let vectorSearchResults = [];
    await Promise.all(
      queryVectors.map(async (embeddings) => {
        let data = await vectorSearch(embeddings, _source, vectorSkip);
        data.map((d) => vectorSearchResults.push(d));
      })
    );

    let data = vectorSearchResults.map((hit) => hit._source);
    return processAdsAdata(data);
  } catch (error) {
    // console.log(error)
    logger.error(error);
  }
}

async function vectorSearch(embeddings, _source, vectorSkip) {
  try {
    const vectorSearch = await client.search({
      index: INDEX_NAME,
      _source,
      from: vectorSkip,
      size: 2,
      body: {
        query: {
          function_score: {
            query: {
              bool: {
                must: {
                  match_all: {},
                },
              },
            },
            functions: [
              {
                script_score: {
                  script: {
                    source:
                      "cosineSimilarity(params.query_vector, 'embeddings_paraphase_minilm_384') + 1.0",
                    params: {
                      query_vector: embeddings,
                    },
                  },
                },
              },
            ],
          },
        },
      },
    });
    return vectorSearch.hits.hits;
  } catch (error) {
    logger.error(error);
  }
}

exports.getFresUserAds = async (skip, networks = [], popularity) => {
  try {
    let query = {
      bool: {
        must: [
          {
            multi_match: {
              query: "poweradspy",
              fields: ["mediaUrl", "othermedia","thumbnail"],
            },
          },
        ],
      },
    };  
    

    const _source = [
      "id",
      "network",
      "postOwner",
      "postOwnerImage",
      "mediaUrl",
      "newsfeedDescription",
      "adUrl",
      "category",
      "network",
      "adTitle",
      "adType",
      "adText",
      "othermedia",
      "lastSeen",
      "thumbnails",
      "thumbnail"
    ];

    if(popularity) _source.push("popularity");

    let response = await client.search({
      from: skip,
      size: 20,
      index: INDEX_NAME,
      body: {
        _source,
        query,
        sort: [
          { lastSeen: { order: "desc" } },
          { popularity: { order: "desc" } }
        ],
      },
    });
    let hits = response?.hits?.hits || [];
    let data = hits.map((hit) => hit._source);
    return processAdsAdata(data, networks);
  } catch (error) {
    logger.error(error);
  }
};
exports.getVectorSearchAds = async (payload, embeddings, skip = 0, popularity, networks = []) => {
  try {
    // Define fields to retrieve
    const _source = [
      "id",
      "network",
      "postOwner",
      "postOwnerImage",
      "mediaUrl",
      "newsfeedDescription",
      "adUrl",
      "category",
      "adTitle",
      "adType",
      "adText",
      "othermedia",
      "lastSeen",
      "thumbnails",
      "thumbnail"
    ];
    if (popularity) _source.push("popularity");

    // Build pre-filtering conditions
    let filterConditions = [];
    Object.keys(payload).forEach((key) => {
      if (Array.isArray(payload[key]) && payload[key].length > 0) {
        const filterQuery =
          payload[key].length > 1
            ? { terms: { [key]: payload[key] } }
            : { term: { [key]: payload[key][0] } };
        filterConditions.push(filterQuery);
      }
    });

    const totalDocsNeeded = skip + 20;
    const num_candidates = Math.max(totalDocsNeeded, 200);


    // Elasticsearch k-NN query
    const esQuery = {
      size: totalDocsNeeded,
      _source,
      query: {
        bool: {
          filter: filterConditions,
          must: [
            {
              multi_match: {
                query: "poweradspy",
                fields: ["mediaUrl", "othermedia","thumbnail"],
              }
            },
            {
              knn: {
                field: "embeddings_paraphase_minilm_384",
                query_vector: embeddings,
                num_candidates: num_candidates
              }
            }
          ]
        }
      },
      sort: [
        { _score: "desc" },
        { lastSeen: { order: "desc" } },
        { popularity: { order: "desc" } }
      ]
    };

    // Execute search in Elasticsearch
    const vectorSearch = await client.search({
      index: INDEX_NAME,
      body: esQuery
    });

    let hits = vectorSearch?.hits?.hits || [];

    // Implementing manual pagination since k-NN doesn't support `from`
    let paginatedHits = hits.slice(skip, skip + 20);

    let data = paginatedHits.map((hit) => hit._source);

    return processAdsAdata(data, networks);
  } catch (error) {
    // console.error("Vector Search Error:", error);
    logger.error(error);
  }
};

exports.getAdvertiserAds = async (payload, skip, networks = [], popularity) => {
  try {
    let query = {
      bool: {
        filter: [],
        must: [
          {
            multi_match: {
              query: "poweradspy",
              fields: ["mediaUrl", "othermedia","thumbnail"]
            }
          }
        ]
      }
    };
    const _source = [
      "id",
      "network",
      "postOwner",
      "postOwnerImage",
      "mediaUrl",
      "newsfeedDescription",
      "adUrl",
      "category",
      "network",
      "adTitle",
      "adType",
      "adText",
      "othermedia",
      "lastSeen",
      "thumbnails",
      "thumbnail"
    ];

    if(popularity) _source.push("popularity");


    Object.keys(payload).forEach((key) => {
      if (Array.isArray(payload[key]) && payload[key].length > 0) {
        const filterQuery =
          payload[key].length > 1
            ? { terms: { [key]: payload[key] } }
            : { term: { [key]: payload[key][0] } };
        query.bool.filter.push(filterQuery);
      }
    });
    let response = await client.search({
      from: skip,
      size: 20,
      index: INDEX_NAME,
      body: {
        _source,
        query,
        sort: [
          { lastSeen: { order: "desc" } },
          { popularity: { order: "desc" } }
        ],
      },
    });
    let hits = response?.hits?.hits;
    let data = hits.map((hit) => hit._source);
    return processAdsAdata(data, networks);
  } catch (error) {
    // console.log(error);
    logger.error(error);
  }
};


let chatEmb = []
let creativeResponseEmb = []
let adCopyResponseEmb = []
let chatDataTime = null
let adCopyChatDataTime = null
let creativeChatDataTime = null
exports.fetchExploreAds = async (from, size, networks, popularity, type, token, uid,platform, competitor,searchType) => {

// if((platform && platform.length>0 )|| (competitor && competitor.length>0)){
//         await competitorSearchInsta((from, size, networks, popularity,type,platform, competitor))
// return await competitorSearch(from, size, networks, popularity,type,platform, competitor)
// }

if((platform || platform.length>0 || platform.length == 0 )|| (competitor && competitor.length>0)){
  let reqNetwork = platform.length > 0 ? platform : ["facebook","instagram"];
  const actions = {
    facebook: competitorSearch,
    instagram: competitorSearchInsta,
    google:competitorSearchGT,
    youtube:competitorSearchYT,
    pinterest: competitorSearchPin,
    linkedin: competitorSearchLinkedIn,
    reddit: competitorSearchReddit,
    google_display_ads: competitorSearchGDN   
};
const promises = reqNetwork
    .filter(p => actions[p]) // Ensure only valid platforms are considered
    .map(p => actions[p](from, size, p, popularity, type, platform, competitor,searchType)); // Execute each function

if (promises.length > 0) {
  let adsData = await Promise.all(promises); // Run all functions at the same time
  return adsData.flat();  // Run all at the same time
}
}

  const urls = [
    `${process.env.GATEWAY_URL}/adsgpt/chat/get-chat-message/${uid}`,
    `${process.env.GATEWAY_URL}/adsgpt/adCreative/get-creativechat-message/${uid}`,
    `${process.env.GATEWAY_URL}/adsgpt/adCopy/get-copychat-message/${uid}`
  ];

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  try {
    if (from === 0) {
      const [chatResponse, creativeChatResponse, adCopyChatResponse] = await Promise.all(
        urls.map(url => axios.get(url, { headers }))
      );

      const chatData = chatResponse.data?.recent_sessions?.data;
       chatDataTime = chatResponse.data?.recent_sessions?.time;
      const creativeChatData = creativeChatResponse.data?.recent_sessions?.data;
       creativeChatDataTime = creativeChatResponse.data?.recent_sessions?.time;
      const adCopyChatData = adCopyChatResponse.data?.recent_sessions?.data;
       adCopyChatDataTime = adCopyChatResponse.data?.recent_sessions?.time;

      const url = `${process.env.EMBEDDING_URL}/text_to_embeddings`;
      const payloads = [];
    if (chatData && typeof chatData === 'string' && chatData.trim()) {
        payloads.push({ text: chatData, stopword_cleaning: true, source:"chatbot" });
      }

      if (creativeChatData && typeof creativeChatData === 'string' && creativeChatData.trim()) {
        payloads.push({ text: creativeChatData, stopword_cleaning: true, source:"adCreative" });
      }

      if (adCopyChatData && typeof adCopyChatData === 'string' && adCopyChatData.trim()) {
        payloads.push({ text: adCopyChatData, stopword_cleaning: true , source:"adcopy"});
      }

      const responses = await Promise.all(payloads.map(payload => axios.post(url, payload,{headers: {
        "secret-key": "secretkey"
      }})));
responses.forEach(response => {
  const source = response?.data?.source;
  const embeddings = response?.data?.embeddings_payload?.illustratedEmbeddings_paraphase_minilm_384 || [];

  if (source === "adcopy") {
      adCopyResponseEmb = embeddings;
  } else if (source === "chatbot") {
      chatEmb = embeddings;
  } else if (source === "adCreative") {
      creativeResponseEmb = embeddings;
  }
});

      return getAdsData(chatEmb,  adCopyResponseEmb,creativeResponseEmb, from, size, networks, popularity, type,[chatDataTime,adCopyChatDataTime,creativeChatDataTime]);
    } else {
      return getAdsData(chatEmb,  adCopyResponseEmb, creativeResponseEmb,from, size, networks, popularity, type, [chatDataTime,adCopyChatDataTime,creativeChatDataTime]);
    }
  } catch (error) {

  }
};


async function getAdsData(
  queryVector1, queryVector2, queryVector3, 
  from, size, networks, popularity, type, 
  [chatDataTime, adCopyChatDataTime, creativeChatDataTime]
) { 

  function convertToEpoch(dateString) {
  try {
    const formattedDateString = dateString ? dateString.replace(/(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})-(\d{2})/, "$1 $2:$3:$4") : "1990-02-06 18-58-05";
    const date = new Date(formattedDateString);
    if (isNaN(date.getTime())) {
    }
    return date.getTime();
  } catch (error) {
  }
}

const timeMappings = [
    { time: convertToEpoch(chatDataTime), vector: queryVector1 },
    { time: convertToEpoch(adCopyChatDataTime), vector: queryVector2 },
    { time: convertToEpoch(creativeChatDataTime), vector: queryVector3 }
];
timeMappings.sort((a, b) => new Date(b.time) - new Date(a.time));

queryVector1 = timeMappings[0].vector;
queryVector2 = timeMappings[1].vector;
queryVector3 = timeMappings[2].vector;
  let currentVector = null
  if ((from / 10) % 3 === 0) {
    currentVector = [queryVector1, queryVector2, queryVector3]
      .find(v => v.length > 0) || [];
  }else if((from / 10) % 3 === 1){
    currentVector = [queryVector2, queryVector3, queryVector1]
    .find(v => v.length > 0) || [];
  }else{
    currentVector = [queryVector3, queryVector1, queryVector2]
    .find(v => v.length > 0) || [];
  }

  const today = new Date();
  const lastMonth = new Date(today);
  lastMonth.setMonth(today.getMonth() - 1);
  
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const lastMonthDate = formatDate(lastMonth);
  const todayDate = formatDate(today);

  const body = {
    from: from,
    size: size,
    _source: [
      "id", "network", "postOwner", "postOwnerImage", "mediaUrl", 
      "newsfeedDescription", "adUrl", "category", "adTitle", "adType", 
      "adText", "othermedia", "lastSeen", "thumbnails", "thumbnail","type"
    ],
    query: {
      bool: {
        filter: [
          { terms: {network: networks }},
          { term: { type: type }}
        ]
      }
    },
    sort: [
      { "_score": { "order": "desc" }},
    ]
  };
  if (popularity) body._source.push("popularity");
  
  if (process?.env?.MODE === 'PROD') {
    body.query.bool.filter.push({ range: { lastSeen: { gte: lastMonthDate, lte: todayDate }}});
  }
  
  if (currentVector && currentVector.length > 0) {
  body.query.bool["should"] = [{
      script_score: {
          query: {
            match_all: {}
          },
          script: {
            source: "cosineSimilarity(params.query_vector, 'embeddings_paraphase_minilm_384') + 2.0",
            params: {
              query_vector:currentVector
            }
          }
        }
  }]

  body['min_score']  = 1.5
  }

  try {
    const response = await client.search({
      index: INDEX_NAME,
      body: body
    });

    return processExploreAdsAdata(response.hits.hits.map((hit) => hit._source))
  } catch (error) {
    console.error('Error fetching ads data:', error.body ? error.body : error.message);
    throw error; 
  }
}

async function competitorSearch(from, size, networks, popularity,type,platform, competitor,searchType){
  try {
      const headers = { 'Content-Type': 'application/json' };
      const axiosConfig = { headers, timeout: 5000 }; // Set timeout to 5s
      const value = Array.isArray(competitor) && competitor.length ? competitor[0] : "NA";
      const fields = { competitor: "advertiser", domain: "domain", keyword: "keyword" };
      let body = {
        "user_id": 35,
        "advertiser": "NA",
        "domain": "NA",
        "keyword": "NA",
        "newest_sort": "newest_sort",
        "running_longest_sort": "NA",
        "last_seen_sort": "NA",
        "likes_sort": "NA",
        "impression_sort": "NA",
        "popularity_sort": "NA",
        "adBudget_sort": "NA",
        "comments_sort": "NA",
        "shares_sort": "NA",
        "domain_sort": "NA",
        "seen_btn_sort": "NA",
        "post_date_btn_sort": "NA",
        "domain_date_btn_sort": "NA",
        "call_to_action": "NA",
        "adcategory": "NA",
        "subCategory": "NA",
        "country": "NA",
        "state": "NA",
        "city": "NA",
        "type": "IMAGE",
        "ad_position": [
          "FEED",
          "SIDE",
          "MARKETPLACE",
          "VIDEOFEED"
        ],
        "gender": "NA",
        "lower_age": "NA",
        "upper_age": "NA",
        "ecommerce": "NA",
        "track": "NA",
        "source": "NA",
        "funnel": "NA",
        "affiliate": "NA",
        "order_column": "post_date",
        "order_by": "desc",
        "take": `${size}`,
        "skip":`${from/10}`,
        "needle": "NA",
        "subscriptionType": 32,
        "favorite": "false",
        "hidden": "false",
        "tags": "NA",
        "version": "NA",
        "selected_user": "NA",
        "lang": "NA",
        "hits_sort": "NA",
        "discoverer_user_id": "NA",
        "likes": "NA",
        "comments": "NA",
        "shares": "NA",
        "impressions": "NA",
        "popularity": "NA",
        "adBudget": "NA",
        "html": "NA",
        "commentdata": "NA",
        "page_creation": "NA",
        "verified": "NA",
        "mixdata": "NA",
        "html_content": "NA",
        "ocr": "NA",
        "image_celebrity": "NA",
        "image_object": "NA",
        "image_logo": "NA",
        "userSubscription": 32,
        "not_country": "",
        "adDetail_id": "NA",
        "market_platform": "NA",
        "language": "en",
        "ad_position_filter": "NA",
        "country_session": 0
      }
          const field = fields[searchType] || "advertiser";
          body[field] = value;
      // const response = await axios.post(`https://api-dev.poweradspy.com/getAdsGPTHandler`, JSON.stringify(body), axiosConfig);
      const response = await axios.post(`${process.env.FB_PAS_URL}/getAdsGPTHandler`, JSON.stringify(body), axiosConfig);
      const adsData = response.data?.data || [];
      if (adsData.length < 6) {
        const result = await advertiserSearch(competitor[0]);
        if (result?.message && result?.message.includes("This is not relevant")) return result;
      }
      
      if (adsData.length > 0) {
        let finalData = await processExploreAdsAdataPAS(adsData, 'facebook');
        // console.log(finalData);
       
        if (finalData.filter(Boolean).length < 6) {
          const result = await advertiserSearch(competitor[0]);
          if (result?.message && result?.message.includes("This is not relevant")) return result;
        }
        return finalData;
      }
return []
  } catch (error) {
    return []
  }
}

async function competitorSearchInsta(from, size, networks, popularity,type,platform, competitor,searchType){
  try {
      const headers = { 'Content-Type': 'application/json' };
      const axiosConfig = { headers, timeout: 5000 }; // Set timeout to 5s
            const value = Array.isArray(competitor) && competitor.length ? competitor[0] : "NA";
      const fields = { competitor: "advertiser", domain: "domain", keyword: "keyword" };
      let body = {
        "user_id": 35,
        "advertiser": "NA",
        "domain": "NA",
        "keyword": "NA",
        "newest_sort": "newest_sort",
        "running_longest_sort": "NA",
        "last_seen_sort": "NA",
        "likes_sort": "NA",
        "impression_sort": "NA",
        "popularity_sort": "NA",
        "adBudget_sort": "NA",
        "comments_sort": "NA",
        "shares_sort": "NA",
        "domain_sort": "NA",
        "seen_btn_sort": "NA",
        "post_date_btn_sort": "NA",
        "domain_date_btn_sort": "NA",
        "call_to_action": "NA",
        "adcategory": "NA",
        "subCategory": "NA",
        "country": "NA",
        "state": "NA",
        "city": "NA",
        "type": "IMAGE",
        "ad_position": [
            "FEED"
        ],
        "gender": "NA",
        "lower_age": "NA",
        "upper_age": "NA",
        "ecommerce": "NA",
        "track": "NA",
        "source": "NA",
        "funnel": "NA",
        "affiliate": "NA",
        "order_column": "post_date",
        "order_by": "desc",
        "take": `${size}`,
        "skip":`${from/10}`,
        "needle": "NA",
        "subscriptionType": 36,
        "lang": "NA",
        "favorite": "false",
        "hidden": "false",
        "likes": "NA",
        "comments": "NA",
        "impressions": "NA",
        "popularity": "NA",
        "adBudget": "NA",
        "html_content": "NA",
        "ocr": "NA",
        "celeb": "NA",
        "logo": "NA",
        "object": "NA",
        "addetails": "NA",
        "similar_ad_id": "NA",
        "userSubscription": 36,
        "market_platform": "NA",
        "language": "en",
        "ad_position_filter": "NA",
        "country_session": 0
    }
     const field = fields[searchType] || "advertiser";
          body[field] = value;
      // const response = await axios.post(`https://api-dev.poweradspy.com/getAdsGPTHandler`, JSON.stringify(body), axiosConfig);
      const response = await axios.post(`${process.env.INST_PAS_URL}/getAdsGPTHandler`, JSON.stringify(body), axiosConfig);
      const adsData = response.data?.data || [];
      if (adsData.length < 6) {
        const result = await advertiserSearch(competitor[0]);
        if (result?.message && result?.message.includes("This is not relevant")) return result;
      }
      
      if (adsData.length > 0) {
        let finalData = await processExploreAdsAdataPAS(adsData, 'instagram');
        
        if (finalData.filter(Boolean).length < 6) {
          const result = await advertiserSearch(competitor[0]);
          if (result?.message && result?.message.includes("This is not relevant")) return result;
        }
        return finalData;
      }
return []
  } catch (error) {
    // console.log(error);
    return []
  }
}

async function competitorSearchGT(from, size, networks, popularity,type,platform, competitor,searchType){
  try {
      const headers = { 'Content-Type': 'application/json' };
      const axiosConfig = { headers, timeout: 5000 }; // Set timeout to 5s
            const value = Array.isArray(competitor) && competitor.length ? competitor[0] : "NA";
      const fields = { competitor: "advertiser", domain: "domain", keyword: "keyword" };
      let body = {
        "user_id": 281,
      "advertiser": "NA",
        "domain": "NA",
        "keyword": "NA",
        "newest_sort": "newest_sort",
        "running_longest_sort": "NA",
        "last_seen_sort": "NA",
        "likes_sort": "NA",
        "comments_sort": "NA",
        "shares_sort": "NA",
        "domain_sort": "NA",
        "seen_btn_sort": "NA",
        "post_date_btn_sort": "NA",
        "domain_date_btn_sort": "NA",
        "target_keywords": "NA",
        "call_to_action": "NA",
        "adcategory": "NA",
        "subCategory": "NA",
        "country": "NA",
        "state": "NA",
        "city": "NA",
        "type": [
            "IMAGE"
        ],
        "ad_position": [
            "FEED"
        ],
        "ad_sub_position": "NA",
        "gender": "NA",
        "lower_age": "NA",
        "upper_age": "NA",
        "ecommerce": "NA",
        "track": "NA",
        "source": "NA",
        "funnel": "NA",
        "affiliate": "NA",
        "order_column": "post_date",
        "order_by": "desc",
        "take": `${size}`,
       "skip":`${from/10}`,
        "needle": "NA",
        "subscriptionType": 36,
        "favorite": "false",
        "hiddenads": "false",
        "lang": "NA",
        "cname": "",
        "html_content": "NA",
        "user_email": "aishwarya@globussoft.in",
        "name": "Tadeu",
        "addetails": "NA",
        "similar_ad_id": "NA",
        "userSubscription": 36,
        "market_platform": "NA",
        "language": "en",
        "ad_position_filter": "NA",
        "type_filter": "NA",
        "network": "Google",
        "method": "getAds"
    }
     const field = fields[searchType] || "advertiser";
          body[field] = value;
      const response = await axios.post(`${process.env.GT_PAS_URL}/api/getAdsGPTHandler`, JSON.stringify(body), axiosConfig);
      const adsData = response.data?.data || [];
      if (adsData.length < 6) {
        const result = await advertiserSearch(competitor[0]);
        if (result?.message && result?.message.includes("This is not relevant")) return result;
      }
      
      if (adsData.length > 0) {
        let finalData = await processExploreAdsAdataPAS(adsData, 'google');
     
        if (finalData.filter(Boolean).length < 6) {
          const result = await advertiserSearch(competitor[0]);
          if (result?.message && result?.message.includes("This is not relevant")) return result;
        }
        return finalData;
      }
return []
  } catch (error) {
    // console.log(error);
    return []
  }
}

async function competitorSearchYT(from, size, networks, popularity,type,platform, competitor,searchType){
  try {
      const headers = { 'Content-Type': 'application/json' };
      const axiosConfig = { headers, timeout: 5000 }; // Set timeout to 5s
            const value = Array.isArray(competitor) && competitor.length ? competitor[0] : "NA";
      const fields = { competitor: "advertiser", domain: "domain", keyword: "keyword" };
    let body = {
      "user_id": 72600,
      "advertiser": "NA",
      "domain": "NA",
      "keyword": "NA",
      "newest_sort": "newest_sort",
      "running_longest_sort": "NA",
      "last_seen_sort": "NA",
      "likes_sort": "NA",
      "adBudget_sort": "NA",
      "dislikes_sort": "NA",
      "comments_sort": "NA",
      "views_sort": "NA",
      "domain_sort": "NA",
      "seen_btn_sort": "NA",
      "post_date_btn_sort": "NA",
      "domain_date_btn_sort": "NA",
      "tags": "NA",
      "call_to_action": "NA",
      "adcategory": "NA",
      "subCategory": "NA",
      "country": "NA",
      "state": "NA",
      "city": "NA",
      "type": [
        "IMAGE"
      ],
      "ad_position": [
        "FEED",
        "SIDE",
        "SHORTS",
        "SEARCHFEED_DISCOVERY",
        "HOMEFEED_DISCOVERY",
        "IN-STREAM",
        "COMPANION"
      ],
      "gender": "NA",
      "lower_age": "NA",
      "upper_age": "NA",
      "ecommerce": "NA",
      "track": "NA",
      "source": "NA",
      "funnel": "NA",
      "affiliate": "NA",
      "order_column": "post_date",
      "order_by": "desc",
      "take": `${size}`,
      "skip": `${from / 10}`,
      "needle": "NA",
      "subscriptionType": 69,
      "favorite": "false",
      "hiddenads": "false",
      "lang": "NA",
      "likes": "NA",
      "comments": "NA",
      "adBudget": "NA",
      "dislikes": "NA",
      "views": "NA",
      "html_content": "NA",
      "verified": "NA",
      "userSubscription": 69,
      "adDetail_id": "NA",
      "market_platform": "NA",
      "commentdata": "NA",
      "ocr": "NA",
      "celebrity": "NA",
      "brand_logo": "NA",
      "object": "NA",
      "language": "en",
      "ad_position_filter": "NA",
      "type_filter": [
        "IMAGE"
      ],
      "ipBasedCountry": "India"
    }

     const field = fields[searchType] || "advertiser";
          body[field] = value;
      // const response = await axios.post(`https://api-dev.poweradspy.com/getAdsGPTHandler`, JSON.stringify(body), axiosConfig);
      const response = await axios.post(`${process.env.YT_PAS_URL}/api/getAdsGPTHandler`, JSON.stringify(body), axiosConfig);
      const adsData = response.data?.data || [];
      if (adsData.length < 6) {
        const result = await advertiserSearch(competitor[0]);
        if (result?.message && result?.message.includes("This is not relevant")) return result;
      }
      
      if (adsData.length > 0) {
        let finalData = await processExploreAdsAdataPAS(adsData, 'youtube');
       
        if (finalData.filter(Boolean).length < 6) {
          const result = await advertiserSearch(competitor[0]);
          if (result?.message && result?.message.includes("This is not relevant")) return result;
        }
        return finalData;
      }
return []
  } catch (error) {
    // console.log(error);
    return []
  }
}

async function competitorSearchLinkedIn(
  from,
  size,
  networks,
  popularity,
  type,
  platform,
  competitor,
  searchType
) {
  try {
    const headers = { "Content-Type": "application/json" };
    const axiosConfig = { headers, timeout: 5000 };

    const value =
      Array.isArray(competitor) && competitor.length
        ? competitor[0]
        : "NA";

    const fields = {
      competitor: "advertiser",
      domain: "domain",
      keyword: "keyword",
    };

     const body = {
    "user_id": 281,
    "advertiser": "NA",
    "domain": "NA",
    "keyword": "NA",
    "newest_sort": "newest_sort",
    "running_longest_sort": "NA",
    "last_seen_sort": "NA",
    "likes_sort": "NA",
    "impressionsort": "NA",
    "popularitysort": "NA",
    "comments_sort": "NA",
    "shares_sort": "NA",
    "domain_sort": "NA",
    "seen_btn_sort": "NA",
    "post_date_btn_sort": "NA",
    "domain_date_btn_sort": "NA",
    "target_keywords": "NA",
    "call_to_action": "NA",
    "adcategory": "NA",
    "subCategory": "NA",
    "country": "NA",
    "state": "NA",
    "city": "NA",
    "type": "IMAGE",
    "ad_position": [
        "FEED",
        "SIDE"
    ],
    "ad_sub_position": "NA",
    "gender": "NA",
    "lower_age": "NA",
    "upper_age": "NA",
    "ecommerce": "NA",
    "track": "NA",
    "source": "NA",
    "funnel": "NA",
    "affiliate": "NA",
    "order_column": "post_date",
    "order_by": "desc",
    "take":`${size}`,
    "skip":`${from/10}`,
    "needle": "NA",
    "subscriptionType": 36,
    "favorite": "false",
    "hiddenads": "false",
    "likes": "NA",
    "comments": "NA",
    "shares": "NA",
    "lang": "NA",
    "html_content": "NA",
    "verified": "NA",
    "user_email": "aishwarya@globussoft.in",
    "name": "Tadeu",
    "impressions": "NA",
    "popularitys": "NA",
    "addetails": "NA",
    "similar_ad_id": "NA",
    "userSubscription": 36,
    "market_platform": "NA",
    "ocr": "NA",
    "image_celebrity": "NA",
    "image_object": "NA",
    "image_logo": "NA",
    "language": "en",
    "ad_position_filter": "NA"
}

    body[fields[searchType] || "advertiser"] = value;

    const response = await axios.post(
      `${process.env.LINKEDIN_PAS_URL}/getAdsGPTHandler`,
      JSON.stringify(body),
      axiosConfig
    );

    const adsData = response.data?.data || [];

    //  FALLBACK ADDED
    if (adsData.length < 6) {
      const result = await advertiserSearch(value);
      if (result?.message?.includes("This is not relevant"))
        return result;
    }

    if (!adsData.length) return [];

    const finalData = await processExploreAdsAdataPAS(
      adsData,
      "linkedin"
    );

    if (finalData.filter(Boolean).length < 6) {
      const result = await advertiserSearch(value);
      if (result?.message?.includes("This is not relevant"))
        return result;
    }

    return finalData;
  } catch (error) {
    logger.error(error);
    return [];
  }
}

async function competitorSearchReddit(
  from,
  size,
  networks,
  popularity,
  type,
  platform,
  competitor,
  searchType
) {
  try {
    const headers = { "Content-Type": "application/json" };
    const axiosConfig = { headers, timeout: 5000 };

    const value =
      Array.isArray(competitor) && competitor.length
        ? competitor[0]
        : "NA";

    const fields = {
      competitor: "advertiser",
      domain: "domain",
      keyword: "keyword",
    };

    const body = {
    "user_id": 281,
    "advertiser": "NA",
    "domain": "NA",
    "keyword": "NA",
    "newest_sort": "newest_sort",
    "running_longest_sort": "NA",
    "last_seen_sort": "NA",
    "likes_sort": "NA",
    "likes": "NA",
    "comments_sort": "NA",
    "shares_sort": "NA",
    "domain_sort": "NA",
    "seen_btn_sort": "NA",
    "post_date_btn_sort": "NA",
    "domain_date_btn_sort": "NA",
    "range": "NA",
    "target_keywords": "NA",
    "call_to_action": "NA",
    "adcategory": "NA",
    "subCategory": "NA",
    "country": "NA",
    "state": "NA",
    "city": "NA",
    "type": "NA",
    "ad_position": [
        "FEED"
    ],
    "ad_sub_position": "NA",
    "gender": "NA",
    "lower_age": "NA",
    "upper_age": "NA",
    "ecommerce": "NA",
    "track": "NA",
    "source": "NA",
    "funnel": "NA",
    "affiliate": "NA",
    "order_column": "post_date",
    "order_by": "desc",
    "take": `${size}`,
    "skip": `${from/10}`,
    "needle": "NA",
    "subscriptionType": 36,
    "favorite": "false",
    "hiddenads": null,
    "lang": "NA",
    "cname": "",
    "ocr": "NA",
    "celeb": "NA",
    "logo": "NA",
    "object": "NA",
    "html_content": "NA",
    "user_email": "aishwarya@globussoft.in",
    "userSubscription": 36,
    "adDetail_id": "NA",
    "market_platform": "NA",
    "language": "en",
    "ad_position_filter": "NA",
    "country_session" : 1
}


    body[fields[searchType] || "advertiser"] = value;

    const response = await axios.post(
      `${process.env.REDDIT_PAS_URL}/getAdsGPTHandler`,
      JSON.stringify(body),
      axiosConfig
    );

    const adsData = response.data?.data || [];

    //  FALLBACK ADDED
    if (adsData.length < 6) {
      const result = await advertiserSearch(value);
      if (result?.message?.includes("This is not relevant"))
        return result;
    }

    if (!adsData.length) return [];

    const finalData = await processExploreAdsAdataPAS(
      adsData,
      "reddit"
    );

    if (finalData.filter(Boolean).length < 6) {
      const result = await advertiserSearch(value);
      if (result?.message?.includes("This is not relevant"))
        return result;
    }

    return finalData;
  } catch (error) {
    logger.error(error);
    return [];
  }
}


async function competitorSearchGDN(
  from,
  size,
  networks,
  popularity,
  type,
  platform,
  competitor,
  searchType
) {
  try {
    const headers = { "Content-Type": "application/json" };
    const axiosConfig = { headers, timeout: 5000 };

    const value =
      Array.isArray(competitor) && competitor.length
        ? competitor[0]
        : "NA";

    const fields = {
      competitor: "advertiser",
      domain: "domain",
      keyword: "keyword",
    };

    const body = {
  
    "user_id": 281,
    "advertiser": "NA",
    "domain": "NA",
    "keyword": "NA",
    "newest_sort": "newest_sort",
    "running_longest_sort": "NA",
    "last_seen_sort": "NA",
    "likes_sort": "NA",
    "comments_sort": "NA",
    "shares_sort": "NA",
    "domain_sort": "NA",
    "seen_btn_sort": "NA",
    "post_date_btn_sort": "NA",
    "domain_date_btn_sort": "NA",
    "target_keywords": "NA",
    "call_to_action": "NA",
    "adcategory": "NA",
    "subCategory": "NA",
    "country": "NA",
    "state": "NA",
    "city": "NA",
    "type": "NA",
    "ad_position": "",
    "ad_sub_position": "NA",
    "gender": "NA",
    "lower_age": "NA",
    "upper_age": "NA",
    "ecommerce": "NA",
    "track": "NA",
    "source": "NA",
    "funnel": "NA",
    "affiliate": "NA",
    "order_column": "post_date",
    "order_by": "desc",
    "take": `${size}`,
    "skip": `${from/10}`,
    "needle": "999999999",
    "subscriptionType": 36,
    "favorite": "false",
    "hiddenads": "false",
    "lang": "NA",
    "cname": "",
    "size": "NA",
    "ocr": "NA",
    "celeb": "NA",
    "logo": "NA",
    "object": "NA",
    "html_content": "NA",
    "addetails": "NA",
    "similar_ad_id": "NA",
    "userSubscription": 36,
    "market_platform": "NA",
    "language": "en",
    "ad_position_filter": "NA"

    };

    body[fields[searchType] || "advertiser"] = value;

    const response = await axios.post(
      `${process.env.GDN_PAS_URL}/api/getAdsGPTHandler`,
      JSON.stringify(body),
      axiosConfig
    );

    const adsData = response.data?.data || [];

    // fallback if low results
    if (adsData.length < 6) {
      const result = await advertiserSearch(value);
      if (result?.message?.includes("This is not relevant"))
        return result;
    }

    if (!adsData.length) return [];

    const finalData = await processExploreAdsAdataPAS(
      adsData,
      "gdn"
    );

    if (finalData.filter(Boolean).length < 6) {
      const result = await advertiserSearch(value);
      if (result?.message?.includes("This is not relevant"))
        return result;
    }

    return finalData;

  } catch (error) {
    logger.error(error);
    return [];
  }
}

async function competitorSearchPin(from, size, networks, popularity,type,platform, competitor,searchType){
  try {
    const headers = { 'Content-Type': 'application/json' };
    const axiosConfig = { headers, timeout: 5000 }; // Set timeout to 5s
          const value = Array.isArray(competitor) && competitor.length ? competitor[0] : "NA";
      const fields = { competitor: "advertiser", domain: "domain", keyword: "keyword" };
    let body = {
      "user_id": 281,
      "advertiser": "NA",
      "domain": "NA",
      "keyword": "NA",
      "newest_sort": "newest_sort",
      "running_longest_sort": "NA",
      "last_seen_sort": "NA",
      "likes_sort": "NA",
      "comments_sort": "NA",
      "shares_sort": "NA",
      "domain_sort": "NA",
      "seen_btn_sort": "NA",
      "post_date_btn_sort": "NA",
      "domain_date_btn_sort": "NA",
      "target_keywords": "NA",
      "call_to_action": "NA",
      "adcategory": "NA",
      "subCategory": "NA",
      "country": "NA",
      "state": "NA",
      "city": "NA",
      "type": "IMAGE",
      "ad_position": [
          "FEED",
          "SIDE"
      ],
      "ad_sub_position": "NA",
      "gender": "NA",
      "lower_age": "NA",
      "upper_age": "NA",
      "ecommerce": "NA",
      "track": "NA",
      "source": "NA",
      "funnel": "NA",
      "affiliate": "NA",
      "order_column": "post_date",
      "order_by": "desc",
     "take": `${size}`,
       "skip":`${from/10}`,
      "needle": "NA",
      "subscriptionType": 36,
      "favorite": "false",
      "hiddenads": "false",
      "lang": "NA",
      "html_content": "NA",
      "user_email": "aishwarya@globussoft.in",
      "name": "Tadeu",
      "addetails": "NA",
      "similar_ad_id": "NA",
      "userSubscription": 36,
      "market_platform": "NA",
      "ocr": "NA",
      "image_celebrity": "NA",
      "image_object": "NA",
      "image_logo": "NA",
      "language": "en",
      "ad_position_filter": "NA",
      "network": "Pinterest",
      "method": "getAds",
      "country_session": 0
  }
   const field = fields[searchType] || "advertiser";
          body[field] = value;
    const response = await axios.post(`${process.env.PINT_PAS_URL}/api/getAdsGPTHandler`, JSON.stringify(body), axiosConfig);
   if( response.data && response.data.data.length>0)
   {
    let finalData =  processExploreAdsAdataPAS(response.data.data,"pinterest");
    if(response.data.data.length === 0){
      const result = await advertiserSearch(competitor[0])
                  if(result?.message.includes("This is not relevant")){
                      return result
                    // }
                  }
    }
    return finalData
   }
return []
} catch (error) {
  // console.log(error);
  return []
}

}



const advertiserSearch = async (advertiserName) => {
  try {
      if (!process.env.GATEWAY_URL) {
          throw new Error("GATEWAY_URL is not defined in environment variables.");
      }

      const baseURL = process.env.GATEWAY_URL;
      const headers = { 'Content-Type': 'application/json' };
      const axiosConfig = { headers, timeout: 5000 }; 
      const response = await axios.post(`${baseURL}/adsgpt/advertiser-search/check-status/`, { advertiserName }, axiosConfig);

      if (response.data.message.includes("Fresh key")) {
          const saveResponse = await axios.post(`${baseURL}/adsgpt/advertiser-search/save-advertiser/`, { advertiserName }, axiosConfig);
          return saveResponse.data;
      }

      return response.data;
  } catch (error) {
      // console.error("Error in advertiserSearch:", error?.message || error);
      // throw error;
  }
};




