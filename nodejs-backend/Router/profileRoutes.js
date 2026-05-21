const express = require("express");
const UserController = require('../controllers/user');
const routes = express.Router();
routes.post("/signup", UserController.createUser).patch("/update-profile/:id", UserController.updateUserById);
module.exports = routes;