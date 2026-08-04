require("dotenv").config();

function createClient(nodeEnv, usernameEnv, passwordEnv) {
  const { Client } = require("@elastic/elasticsearch");

  const elasticUrl = process.env[nodeEnv];
  const username = process.env[usernameEnv];
  const password = process.env[passwordEnv];

  if (!elasticUrl || !username || !password) {
    throw new Error(
      `Missing ES config. Ensure ${nodeEnv}, ${usernameEnv}, and ${passwordEnv} are set in env.`,
    );
  }

  const nodeWithAuth = elasticUrl
    .replace(/\/$/, "")
    .replace("http://", `http://${username}:${password}@`);

  return new Client({ node: nodeWithAuth });
}

const clientConfigs = {
  facebook: ["COMPETITOR_ELASTIC_NODE_FB", "COMPETITOR_ELASTIC_USERNAME_FB", "COMPETITOR_ELASTIC_PASSWORD_FB"],
  instagram: ["COMPETITOR_ELASTIC_NODE_IG", "COMPETITOR_ELASTIC_USERNAME_IG", "COMPETITOR_ELASTIC_PASSWORD_IG"],
  youtube: ["COMPETITOR_ELASTIC_NODE_YT", "COMPETITOR_ELASTIC_USERNAME_YT", "COMPETITOR_ELASTIC_PASSWORD_YT"],
  google: ["COMPETITOR_ELASTIC_NODE_GG", "COMPETITOR_ELASTIC_USERNAME_GG", "COMPETITOR_ELASTIC_PASSWORD_GG"],
  linkedin: ["COMPETITOR_ELASTIC_NODE_LD", "COMPETITOR_ELASTIC_USERNAME_LD", "COMPETITOR_ELASTIC_PASSWORD_LD"],
  gdn: ["COMPETITOR_ELASTIC_NODE_GDN", "COMPETITOR_ELASTIC_USERNAME_GDN", "COMPETITOR_ELASTIC_PASSWORD_GDN"],
};

const clients = {};

module.exports = new Proxy({}, {
  get(_target, platform) {
    if (!clientConfigs[platform]) return undefined;
    if (!clients[platform]) {
      clients[platform] = createClient(...clientConfigs[platform]);
    }
    return clients[platform];
  },
});
