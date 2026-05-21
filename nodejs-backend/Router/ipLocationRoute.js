const express = require("express");
const { getLocation } = require('../controllers/ipLocation');
const routes = express.Router();
routes.post("/:ip", getLocation);
module.exports = routes;