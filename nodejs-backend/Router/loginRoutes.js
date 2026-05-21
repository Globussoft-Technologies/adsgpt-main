const express = require("express");
const { loginCheck } = require('../controllers/login');
const routes = express.Router();
routes.post("/", loginCheck);
module.exports = routes;