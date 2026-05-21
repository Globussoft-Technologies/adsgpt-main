
const User = require("../Module/user/userDetails");
const { findOne } = require('../Module/user/userDetails');
const { generateJWT } = require('../services/authService');
const response = require("./responses/response")

exports.loginCheck = async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validate request body
        if (!username || !password) {
            return res.status(400).json(response.validationFailResp('Username and password are required', null));
        }

        // Find user
        const userDetails = await findOne({ username: username, password: password });
        if (!userDetails) {
            console.log('User not found');
            return res.status(401).json(response.FailResp('Invalid username or password', null));
        }

        // Create user object for JWT payload
        const user = { id: userDetails._id, username: userDetails.username };

        // Generate JWT token
        const token = generateJWT(user);

        // Return success response with JWT token
        return res.status(200).json(response.SuccessResp('Login successful', { token: token }));
    } catch (error) {
        console.error('Error during login:', error);
        return res.status(500).json(response.FailResp('Internal server error', error));
    }
  }