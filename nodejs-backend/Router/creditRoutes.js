// routes/creditRoutes.js
const express = require('express');
const router = express.Router();
const { 
    getCreditUsage, 
    getCreditUsageByModel, 
    getCreditsByModels,
    getBasicCreditsByModels,
} = require('../controllers/creditController');

// Middleware to verify token and extract user info
const authenticateToken = (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Access token required'
            });
        }

        const user = TokenDecode(token);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Token authentication error:', error);
        return res.status(401).json({
            success: false,
            error: 'Token authentication failed'
        });
    }
};

// Existing routes
router.get('/usage/:user_id', getCreditUsage);
router.get('/usage/:user_id/model/:model', getCreditUsageByModel);
router.get('/models/:user_id/simple', getCreditsByModels);
router.get('/models/:user_id/basic', getBasicCreditsByModels);

module.exports = router;