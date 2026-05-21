

exports.getAdsData = async (req, res) => {
    try {
       // const context = req?.params?.context;
        const skip = req?.query?.skip;
        const uid = req?.query?.uid;
        const limit = req.query?.limit;
        const context = req.query?.context;
        const contextId = req.query?.contextId;
        const networks = req.query?.network;
        const post_owner_name = req.query?.post_owner_name;
         const response = await fetch(`https://f343-122-166-210-206.ngrok-free.app/adsDataScroll?uid=${uid}&chatId=15135&skip=${skip}&limit=${limit}&context=${context?? []}&contextId=${contextId}&networks=${networks??[]}&postOwner=${post_owner_name??[]}`);
         if (response?.ok) {
            const adsData = await response.json()
            res.status(200).json({ code: 200, adsData: adsData });
        } 
        
        else {
            res.status(404).json({ code: 404, adsData: "Not Found!" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ code: 500, message: "Internal Server Error" });
    }
}