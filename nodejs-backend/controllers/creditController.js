const { CreditTrackingService, CreditDeduction } = require('../services/creditTrackingService');

const getCreditUsage = async (req, res) => {
    try {
        const { user_id } = req.params;
        const { period = 'month' } = req.query; // day, week, month, year
        
        const summary = await CreditTrackingService.getCreditUsageSummary(
            user_id, 
            CreditTrackingService.getPeriodStartDate(period),
            new Date()
        );
        
        const totalCredits = await CreditTrackingService.getTotalCreditsUsed(user_id, period);
        
        res.json({
            success: true,
            data: {
                summary,
                total_credits: totalCredits,
                period: period
            }
        });
    } catch (error) {
        console.error('Error getting credit usage:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve credit usage'
        });
    }
};

const getCreditUsageByModel = async (req, res) => {
    try {
        const { user_id, model } = req.params;
        const { startDate, endDate } = req.query;
        
        const matchStage = {
            user_id: user_id,
            model: model
        };
        
        if (startDate && endDate) {
            matchStage.timestamp = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }
        
        const usage = await CreditDeduction.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: "$service_type",
                    model: "$model",
                    total_credits: { $sum: "$credits_deducted" },
                    usage_count: { $sum: 1 },
                    average_credits_per_use: { $avg: "$credits_deducted" }
                }
            }
        ]);
        
        res.json({
            success: true,
            data: usage
        });
    } catch (error) {
        console.error('Error getting credit usage by model:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve credit usage by model'
        });
    }
};


const getCreditsByModels = async (req, res) => {
    try {
        const { user_id } = req.params;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        const creditsByModels = await CreditDeduction.aggregate([
            {
                $match: { user_id: user_id }
            },
            {
                $group: {
                    _id: "$model",
                    credits: { $sum: "$credits_deducted" }
                }
            },
            {
                $project: {
                    model: "$_id",
                    credits: 1,
                    _id: 0
                }
            },
            {
                $sort: { credits: -1 }
            }
        ]);

        const totalCredits = creditsByModels.reduce((sum, model) => sum + model.credits, 0);

        res.json({
            success: true,
            data: {
                user_id: user_id,
                total_credits: totalCredits,
                models: creditsByModels
            }
        });

    } catch (error) {
        console.error('Error getting simple credits by models:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve credits by models'
        });
    }
};

const getBasicCreditsByModels = async (req, res) => {
    try {
        const { user_id } = req.params;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required'
            });
        }

        // Simple aggregation - just model and credits
        const creditsByModels = await CreditDeduction.aggregate([
            {
                $match: {
                    user_id: user_id
                }
            },
            {
                $group: {
                    _id: "$model",
                    total_credits_deducted: { $sum: "$credits_deducted" },
                    usage_count: { $sum: 1 }
                }
            },
            {
                $project: {
                    model: "$_id",
                    total_credits_deducted: 1,
                    usage_count: 1,
                    _id: 0
                }
            },
            {
                $sort: { total_credits_deducted: -1 }
            }
        ]);

        // Calculate total
        const totalCredits = creditsByModels.reduce((sum, model) => sum + model.total_credits_deducted, 0);

        // Simple response
        const response = {
            user_id: user_id,
            total_credits_all_models: totalCredits,
            models: creditsByModels.map(model => ({
                model: model.model,
                credits_deducted: model.total_credits_deducted,
                usage_count: model.usage_count,
                percentage: totalCredits > 0 ? 
                    ((model.total_credits_deducted / totalCredits) * 100).toFixed(2) + '%' : '0%'
            }))
        };

        res.json({
            success: true,
            data: response
        });

    } catch (error) {
        console.error('Error getting basic credits by models:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve credits by models'
        });
    }
};


module.exports = {
    getCreditUsage,
    getCreditUsageByModel,
    getCreditsByModels,
    getBasicCreditsByModels

};