const axios = require('axios')


const getLocation = async (req,res) => {
 try {
    const ipAddress = req.params.ip
    const ipApiUrl = `http://ip-api.com/json/${ipAddress}`;
      const response = await axios.get(ipApiUrl);
      res.status(200).json(response.data)
  }
 catch (error) {
    res.status(500).json({status:"Unexpected Error to fetch ip details"})
 }
}

module.exports = {getLocation}