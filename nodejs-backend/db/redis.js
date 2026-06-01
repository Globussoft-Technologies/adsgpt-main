const { Redis } = require("ioredis");

const redisClient = new Redis({
  host: process.env.HOST,
  port: process.env.RD_PORT,
  username: process.env.RD_USERNAME,
  password: process.env.redisPass,
});

const pub = new Redis({
  host: process.env.HOST,
  port: process.env.RD_PORT,
  username: process.env.RD_USERNAME,
  password: process.env.redisPass,
});

const sub = new Redis({
  host: process.env.HOST,
  port: process.env.RD_PORT,
  username: process.env.RD_USERNAME,
  password: process.env.redisPass,
  enableReadyCheck: false,
});

module.exports = {
  redisClient,
  pub,
  sub,
};
