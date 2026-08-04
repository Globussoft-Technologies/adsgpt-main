require("dotenv").config();

let client;

function getClient() {
  if (!client) {
    const { Client } = require("@elastic/elasticsearch");

    if (!process.env.elasticNode1 || !process.env.ELASTIC_USERNAME || !process.env.ELASTIC_PASSWORD) {
      throw new Error("Missing ads Elasticsearch config: elasticNode1, ELASTIC_USERNAME, ELASTIC_PASSWORD");
    }

    client = new Client({
      nodes: [process.env.elasticNode1],
      auth: {
        username: process.env.ELASTIC_USERNAME,
        password: process.env.ELASTIC_PASSWORD,
      },
    });
  }

  return client;
}

module.exports = new Proxy({}, {
  get(_target, prop) {
    const esClient = getClient();
    const value = esClient[prop];
    return typeof value === "function" ? value.bind(esClient) : value;
  },
});
