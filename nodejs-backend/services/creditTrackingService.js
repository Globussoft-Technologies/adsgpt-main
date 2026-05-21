// services/creditTrackingService.js
const mongoose = require('mongoose');
const { createAdsCopyChat } = require('../sockets/setupSockets');
const { redisGetSet } = require('../controllers/adCopy');
const { imageEntries, videoEntries } = require('../config/modelRegistry');

// Generation-model canonical keys come from the registry. ADSGPT-TEXT / -CHAT
// / -VIDEO aren't generation models (they're for ad copy / chat / generic
// video tracking) — keep them as static additions.
const NON_GENERATION_MODELS = ["ADSGPT-TEXT", "ADSGPT-CHAT", "ADSGPT-VIDEO"];
const MODEL_ENUM = [
  ...imageEntries().map((e) => e.canonicalKey),
  ...videoEntries().map((e) => e.canonicalKey),
  ...NON_GENERATION_MODELS,
];

const creditDeductionSchema = new mongoose.Schema({
  user_id: {
    type: String,
    required: true,
    index: true
  },
  model: {
    type: String,
    required: true,
    enum: MODEL_ENUM
  },
  service_type: {
    type: String,
    required: true,
    enum: ["ad_creative", "ad_video", "ad_copy", "chat"]
  },
  credits_deducted: {
    type: Number,
    required: true,
    min: 0
  },
  details: {
    item_count: Number, // number of images/videos/copies
    duration: String, // for videos
    aspect_ratio: String,
    resolution: String
  },
  session_id: String,
  chat_id: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const CreditDeduction = mongoose.model('CreditDeduction', creditDeductionSchema);

class CreditTrackingService {
  /**
   * Record credit deduction for a specific model and service
   */
  static async recordCreditDeduction(deductionData) {
    try {
      const deduction = new CreditDeduction(deductionData);
      console.log(deduction,"deductiondeduction");
      await deduction.save();
      
      // Also update real-time totals in Redis if needed
    //   await this.updateRealtimeCreditTotal(deductionData);
      
      return deduction;
    } catch (error) {
      console.error('Error recording credit deduction:', error);
      throw error;
    }
  }

  /**
   * Get credit usage summary by user and model
   */
  static async getCreditUsageSummary(user_id, startDate, endDate) {
    try {
      const matchStage = {
        user_id: user_id,
        timestamp: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };

      const summary = await CreditDeduction.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              model: "$model",
              service_type: "$service_type"
            },
            total_credits: { $sum: "$credits_deducted" },
            usage_count: { $sum: 1 },
            last_used: { $max: "$timestamp" }
          }
        },
        {
          $project: {
            model: "$_id.model",
            service_type: "$_id.service_type",
            total_credits: 1,
            usage_count: 1,
            last_used: 1,
            _id: 0
          }
        }
      ]);

      return summary;
    } catch (error) {
      console.error('Error getting credit usage summary:', error);
      throw error;
    }
  }

  /**
   * Get total credits used by a user
   */
  static async getTotalCreditsUsed(user_id, period = 'month') {
    try {
      const startDate = this.getPeriodStartDate(period);
      
      const result = await CreditDeduction.aggregate([
        {
          $match: {
            user_id: user_id,
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            total_credits: { $sum: "$credits_deducted" }
          }
        }
      ]);

      return result.length > 0 ? result[0].total_credits : 0;
    } catch (error) {
      console.error('Error getting total credits used:', error);
      throw error;
    }
  }

  /**
   * Update real-time credit totals in Redis
   */
//   static async updateRealtimeCreditTotal(deductionData) {
//     const { user_id, model, service_type, credits_deducted } = deductionData;
    
//     // Update model-specific total
//     const modelKey = `CreditUsage:${user_id}:${model}`;
//     await this.redisIncrement(modelKey, credits_deducted);
    
//     // Update service-type total
//     const serviceKey = `CreditUsage:${user_id}:${service_type}`;
//     await this.redisIncrement(serviceKey, credits_deducted);
    
//     // Update overall total
//     const totalKey = `CreditUsage:${user_id}:total`;
//     await this.redisIncrement(totalKey, credits_deducted);
//   }

//   static async redisIncrement(key, value) {
//     return new Promise((resolve, reject) => {
//       createAdsCopyChat.redisGetSet.incrby(key, value, (err, result) => {
//         if (err) reject(err);
//         else resolve(result);
//       });
//     });
//   }

//   static getPeriodStartDate(period) {
//     const now = new Date();
//     switch (period) {
//       case 'day':
//         return new Date(now.setHours(0, 0, 0, 0));
//       case 'week':
//         return new Date(now.setDate(now.getDate() - 7));
//       case 'month':
//         return new Date(now.setMonth(now.getMonth() - 1));
//       case 'year':
//         return new Date(now.setFullYear(now.getFullYear() - 1));
//       default:
//         return new Date(now.setMonth(now.getMonth() - 1));
//     }
//   }
}

module.exports = { CreditTrackingService, CreditDeduction };