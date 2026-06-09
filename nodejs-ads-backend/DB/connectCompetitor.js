const { Client } = require('@elastic/elasticsearch');
require("dotenv").config();

function createClient(nodeEnv, usernameEnv, passwordEnv) {
  const elasticUrl = process.env[nodeEnv];
  const username = process.env[usernameEnv];
  const password = process.env[passwordEnv];

  if (!elasticUrl || !username || !password) {
    throw new Error(
      `Missing ES config. Ensure ${nodeEnv}, ${usernameEnv}, and ${passwordEnv} are set in env.`
    );
  }

  const nodeWithAuth = elasticUrl
    .replace(/\/$/, '')
    .replace('http://', `http://${username}:${password}@`);

  return new Client({ node: nodeWithAuth });
}

// One client per platform — each reads from its own env variables
const clients = {
  facebook: createClient(
    'COMPETITOR_ELASTIC_NODE_FB',
    'COMPETITOR_ELASTIC_USERNAME_FB',
    'COMPETITOR_ELASTIC_PASSWORD_FB'
  ),
  instagram: createClient(
    'COMPETITOR_ELASTIC_NODE_IG',
    'COMPETITOR_ELASTIC_USERNAME_IG',
    'COMPETITOR_ELASTIC_PASSWORD_IG'
  ),
  youtube: createClient(
    'COMPETITOR_ELASTIC_NODE_YT',
    'COMPETITOR_ELASTIC_USERNAME_YT',
    'COMPETITOR_ELASTIC_PASSWORD_YT'
  ),
  google: createClient(
    'COMPETITOR_ELASTIC_NODE_GG',
    'COMPETITOR_ELASTIC_USERNAME_GG',
    'COMPETITOR_ELASTIC_PASSWORD_GG'
  ),
};

module.exports = clients;
