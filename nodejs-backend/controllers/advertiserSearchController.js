const Advertiser = require("../Module/advertiserSearch/advertiserSearchSchema");
const logger = require('../utils/logger');

exports.getAdvertiserName = async (req, res) => {
    try {
        const networksList = ['google', 'youtube', 'instagram', 'facebook', 'pinterest'];
        const network = req.params?.network?.toLowerCase();

        if (!network || !networksList.includes(network)) {
            return res.status(400).json({ error: `Network must be one of: ${networksList.join(', ')}` });
        }

        const advertiser = await Advertiser.findOne({ [`relevantNetworks.${network}`]: null });

        if (!advertiser) {
            return res.status(404).json({ error: "No relevant advertisers found" });
        }

        advertiser.networks = advertiser.networks || {};
        if (!advertiser.networks[network]) {
            const data = getDataForNetwork(advertiser.advertiserName, network);
            advertiser.networks[network] = true;
            await advertiser.save();
            return res.status(200).json(data);
        }
        return res.status(200).json({
            advertiserName: advertiser.advertiserName,
            network,
            message: "Waiting for relevancy update"
        });

    } catch (error) {
        logger.error(`Error in getAdvertiserName: ${error.message}`);
        res.status(500).json({ error: "Internal server error" });
    }
};


// Placeholder function for data retrieval
function getDataForNetwork(advertiserName, network) {
    return {
        advertiserName,
        network,
        data: `Sample data for ${advertiserName} on ${network}`
    };
}

exports.saveAdvertiserName = async (req, res) => {
    try {
        const { advertiserName, relevantNetworks } = req.body;
        if (!advertiserName) {
            return res.status(400).json({ error: "Advertiser name is required" });
        }

        const existingAdvertiser = await Advertiser.findOne({ advertiserName });
        if (existingAdvertiser) {
            return res.status(400).json({ error: "Advertiser already exists" });
        }

        const defaultNetworks = {
            google: false,
            youtube: false,
            instagram: false,
            facebook: false,
            pinterest: false
        };

        const newAdvertiser = new Advertiser({
            advertiserName,
            networks: { ...defaultNetworks },
            relevantNetworks: { google: null, youtube: null, instagram: null, facebook: null, pinterest: null }
        });

        await newAdvertiser.save();
        res.status(201).json(newAdvertiser);
    } catch (error) {
        logger.error(`Error in saveAdvertiserName: ${error.message}`);
        res.status(500).json({ error: "Internal server error" });
    }
};

exports.updateAdvertiserRelevancy = async (req, res) => {
    try {
        const { advertiserName, relevancy } = req.body;
        if (!advertiserName || !relevancy || typeof relevancy !== 'object') {
            return res.status(400).json({ error: "Invalid request data" });
        }

        const advertiser = await Advertiser.findOne({ advertiserName });
        if (!advertiser) {
            return res.status(404).json({ error: "Advertiser not found" });
        }

        const allRelevant = Object.values(relevancy).every(value => value === true);

        if (allRelevant) {
            await Advertiser.deleteOne({ advertiserName });
            return res.status(200).json({ message: "Advertiser deleted due to full relevancy" });
        }

        Object.keys(relevancy).forEach(network => {
            if (advertiser.relevantNetworks.hasOwnProperty(network)) {
                advertiser.relevantNetworks[network] = relevancy[network];
            }
        });

        await advertiser.save();
        res.status(200).json({ message: "Relevancy updated successfully", advertiser });
    } catch (error) {
        logger.error(`Error in updateAdvertiserRelevancy: ${error.message}`);
        res.status(500).json({ error: "Internal server error" });
    }
};



exports.checkAdvertiserStatus = async (req, res) => {
    try {
        const { advertiserName } = req.body;
        if (!advertiserName) {
            return res.status(400).json({ error: "Advertiser name is required" });
        }

        const advertiser = await Advertiser.findOne({ advertiserName });
        // console.log(advertiser);
        if (!advertiser) {
            return res.status(200).json({ message: "Fresh key" , status:0 });
        }

        if (Object.values(advertiser.relevantNetworks).includes(null)) {
            return res.status(200).json({ message: "Waiting for relevancy update",status:advertiser?.status });
        }

        if (Object.values(advertiser.relevantNetworks).includes(false)) {
            return res.status(200).json({ message: "This is not relevant" ,status:advertiser?.status});
        }

        return res.status(200).json({ message: "Advertiser is fully relevant",status:advertiser?.status });
    } catch (error) {
        logger.error(`Error in checkAdvertiserStatus: ${error.message}`);
        res.status(500).json({ error: "Internal server error" });
    }
};


exports.resetAdvertiserStatus = async (req, res) => {
    try {
        const { advertiserName } = req.params;
        if (!advertiserName) {
            return res.status(400).json({ error: "Advertiser name is required" });
        }

        const advertiser = await Advertiser.findOne({ advertiserName });
        if (!advertiser) {
            return res.status(404).json({ error: "Advertiser not found" });
        }

        const defaultNetworks = {
            google: false,
            youtube: false,
            instagram: false,
            facebook: false,
            pinterest: false
        };

        advertiser.networks = { ...defaultNetworks };
        advertiser.relevantNetworks = { google: null, youtube: null, instagram: null, facebook: null, pinterest: null };
        advertiser.status = 1;

        await advertiser.save();
        res.status(200).json({ message: "Advertiser status reset successfully", advertiser });
    } catch (error) {
        logger.error(`Error in resetAdvertiserStatus: ${error.message}`);
        res.status(500).json({ error: "Internal server error" });
    }
};