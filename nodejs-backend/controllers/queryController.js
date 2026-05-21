const { v4: uuidv4 } = require('uuid');
const { redisGetSet } = require('./adCopy');

/**
 * POST /api/query/save
 * Save query and token to Redis
 */
const saveQuery = async (req, res) => {
  const { query, token } = req.body;

  if (!query || !token) {
    return res.status(400).json({
      success: false,
      message: "Both 'query' and 'token' fields are required",
    });
  }

  try {
    const key = `query:${uuidv4()}`;
    const ttl = 60 * 60; // 1 hour

    const data = JSON.stringify({ query, token });

    await new Promise((resolve, reject) => {
      redisGetSet.setex(key, ttl, data, (err, reply) => {
        if (err) return reject(err);
        resolve(reply);
      });
    });

    return res.json({
      success: true,
      key,
      message: 'Query and token saved successfully',
    });
  } catch (error) {
    console.error('Error saving query:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

/**
 * GET /api/query/:key
 * Retrieve saved query and token
 */
const getQuery = async (req, res) => {
    const { key } = req.params;
  
    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'Key is required',
      });
    }
  
    try {
      const result = await new Promise((resolve, reject) => {
        redisGetSet.get(key, (err, reply) => {
          if (err) return reject(err);
          console.log('Raw reply from Redis:', reply);
          resolve(reply);
        });
      });
  
      if (!result) {
        console.warn('Key not found or expired in Redis:', key);
        return res.status(404).json({
          success: false,
          message: 'Query not found or expired',
        });
      }
  
      // delete after successful fetch
      redisGetSet.del(key, (err) => {
        if (err) console.error('Error deleting key after fetch:', err);
        else console.log(`Deleted key from Redis: ${key}`);
      });
  
      let data;
      try {
        data = JSON.parse(result);
      } catch (parseError) {
        console.error('Failed to parse Redis data:', parseError, 'Raw data:', result);
        return res.status(500).json({
          success: false,
          message: 'Failed to parse query data',
        });
      }
  
      return res.json({
        success: true,
        data,
      });
  
    } catch (error) {
      console.error('Error retrieving query:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  };
  
  

module.exports = { saveQuery, getQuery };
