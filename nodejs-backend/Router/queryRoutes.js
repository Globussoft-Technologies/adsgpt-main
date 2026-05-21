const express = require('express');
const router = express.Router();
const { saveQuery, getQuery } = require('../controllers/queryController');

// Save query + token
router.post('/save', saveQuery);

// Get query + token
router.get('/:key', getQuery);

module.exports = router;
