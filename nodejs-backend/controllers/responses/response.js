class Response {
    validationFailResp(message, error) {
        return {
            statusCode: 400,
            body: {
                status: 'failed',
                message: message,
                error: error,
            },
        };
    }

    SuccessResp(message, projectDetails) {
        return {
            statusCode: 200,
            body: {
                status: 'success',
                message: message,
                data: projectDetails,
            },  
        };
    }

    PartialSuccessResp(message, projectDetails) {
        return {
            statusCode: 206,
            body: {
                status: 'success',
                message: message,
                data: projectDetails,
            },
        };
    }

    FailResp(msg, err) {
        return {
            statusCode: 400,
            body: {
                status: 'failed',
                message: msg,
                error: err,
            },
        };
    }
    SocialCallbackResponse(res, navigateUrl, token = null, message, statusCode = 200, status = 'success') {
        return {
            statusCode,
            status,
            body: {
                message,
                navigateUrl,
                token,
            },
        };
    }
    tokenFailResp(message, error) {
        return {
            statusCode: 400,
            body: {
                status: 'failed',
                message: message,
                error: error,
            },
        };
    }
    accessDeniedResp(message, error) {
        return {
            statusCode: 403,
            body: {
                status: 'failed',
                message: message,
                error: error,
            },
        };
    }
    PartialSuccessResp(message, PartialDetails) {
        return {
            statusCode: 206,
            body: {
                status: 'success',
                message: message,
                data: PartialDetails,
            },
        };
    }
}

module.exports =  new Response();
