const express = require("express"); 
const accessLogs = require("../../controllers/Tracks/accesslogs")
const router = express.Router();

router.post('/save-route', accessLogs.saveRoute).get("/get-route/:user_id", accessLogs.getRoutes)


module.exports = router;