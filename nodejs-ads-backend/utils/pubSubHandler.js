const ioredis = require("ioredis");
require("dotenv").config();

exports.pub = new ioredis.Redis({
  host: process.env.PUB_SUB_HOST,
  port: process.env.PUB_SUB_PORT,
  username: process.env.PUB_SUB_USERNAME,
  password: process.env.PUB_SUB_PASSWORD,
});
