const { object } = require('joi');
const FAQ = require('../Module/FAQ/faq')

// Create an FAQ
const createFAQ = async (req, res) => {
  
    try {
        // if(req.params || req.query) return res.status(400).send({ error: 'Please use proper api' });
      const { faqId } = req.body;
  
      const existingFAQ = await FAQ.findOne({ faqId });
      if (existingFAQ) {
        return res.status(400).send({ error: 'FAQ with this faqId already exists' });
      }
  
      const faq = new FAQ(req.body);
      await faq.save();
      res.status(201).send(faq);
    } catch (error) {
      res.status(400).send(error);
    }
  };
  
  // const getFAQs = async (req, res) => {
  
  //   let { faqId, skip, limit, search } = req.query;
  
  //   try {
       
  //     if (Object.keys(req.query).length >= 1 && !faqId && !search && !skip && !limit) {
  //       return res.status(400).send({ error: 'Invalid query parameters' });
  //     }
  
  //     if (!faqId && !search && !skip && !limit) {
  //       const faqs = await FAQ.find({});
  //       return res.status(200).send(faqs);
  //     }
  
  //     if (faqId) {
  //       const faq = await FAQ.findOne({ faqId: faqId });
  //       if (!faq) {
  //         return res.status(404).send({ error: 'FAQ not found' });
  //       }
  //       return res.status(200).send(faq);
  //     }
  
  //     let query = {};
  //     if(search && (!limit && !skip)){
  //       const searchRegex = new RegExp(search, 'i');
  //       query.question = searchRegex;
  //     skip = skip ? parseInt(skip, 10) : 0;
  //     limit = limit ? parseInt(limit, 10) : 4;
  //     const faqs = await FAQ.find(query)
  //     res.status(200).send(faqs);
  //     }
  //     if (search && (limit||skip)) {
  //       const searchRegex = new RegExp(search, 'i');
  //       query.question = searchRegex;
      
  
  //     skip = skip ? parseInt(skip, 10) : 0;
  //     limit = limit ? parseInt(limit, 10) : 4;
  
  //     const faqs = await FAQ.find(query)
  //       .skip(skip)
  //       .limit(limit);
  
  //     res.status(200).send(faqs);
  //     }

  //     if(!search && (limit || skip)){
  //       const faqs = await FAQ.find(query)
  //       .skip(skip)
  //       .limit(limit);
  
  //     res.status(200).send(faqs);
  //     }
  //   } catch (error) {
  //     res.status(400).send({ error: 'Invalid query parameters' });
  //   }
  // };
  
  const getFAQs = async (req, res) => {
    let { faqId, count, search, exclude } = req.query;
    
    try {
        // ... existing validation code ...
        
        const faqCount = count ? parseInt(count, 10) : 4;
        let excludeIds = [];
        
        if (exclude) {
            excludeIds = exclude.split(',').map(id => id.trim());
        }
        
        let aggregationPipeline = [];
        
        // Exclude specific FAQ IDs if provided
        if (excludeIds.length > 0) {
            aggregationPipeline.push({
                $match: { 
                    _id: { $nin: excludeIds.map(id => new mongoose.Types.ObjectId(id)) }
                }
            });
        }
        
        // Add search filter if provided
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            aggregationPipeline.push({
                $match: { question: searchRegex }
            });
        }
        
        // Get random samples
        aggregationPipeline.push({ $sample: { size: faqCount } });
        
        const randomFaqs = await FAQ.aggregate(aggregationPipeline);
        res.status(200).send(randomFaqs);
        
    } catch (error) {
        console.error('Error fetching FAQs:', error);
        res.status(500).send({ error: 'Internal server error' });
    }
};
  
  // Update an FAQ
  const updateFAQ = async (req, res) => {
  
     
    const updates = Object.keys(req.body);
    const allowedUpdates = ['question'];
    const isValidOperation = updates.every((update) => allowedUpdates.includes(update));
  
    if (!isValidOperation) {
      return res.status(400).send({ error: 'Invalid updates!' });
    }
  
    try {
      const faq = await FAQ.findOne({ faqId: req.params.id });
      if (!faq) {
        return res.status(404).send();
      }
  
      updates.forEach((update) => faq[update] = req.body[update]);
      await faq.save();
      res.status(200).send(faq);
    } catch (error) {
      res.status(400).send(error);
    }
  };
  
  // Delete an FAQ
  const deleteFAQ = async (req, res) => {
     
    try {
      const faq = await FAQ.findOneAndDelete({ faqId: req.params.id });
      if (!faq) {
        return res.status(404).send();
      }
      res.status(200).send(faq);
    } catch (error) {
      res.status(500).send(error);
    }
  }
  
  module.exports = {
    createFAQ,
    getFAQs,
    updateFAQ,
    deleteFAQ,
  };