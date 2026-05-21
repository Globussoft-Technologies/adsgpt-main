const { Client } = require('@elastic/elasticsearch');
require("dotenv").config();

const client = new Client({
  nodes: [
    process.env.elasticNode1,
    // process.env.elasticNode2,
    // process.env.elasticNode3
  ],
  auth: {
    username: process.env.ELASTIC_USERNAME,
    password: process.env.ELASTIC_PASSWORD,
  }
});

module.exports = client