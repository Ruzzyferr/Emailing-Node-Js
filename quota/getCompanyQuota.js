const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const { responseStatus } = require('../../utils/response');

exports.fetchCompanyMessageLimits = async (event) => {
    const appId = event.queryStringParameters.appId;

    if (!appId) {
        return responseStatus(400, {
            message: 'Missing required query parameter: appId',
        });
    }

    try {
        const messageLimits = await getCompanyMessageLimits(appId);
        return responseStatus(200, messageLimits);
    } catch (error) {
        return responseStatus(500, {
            message: error.message,
        });
    }
};

const getCompanyMessageLimits = async (appId) => {
    const params = {
        TableName: process.env.COMPANY_MESSAGE_LIMITS_TABLE,
        FilterExpression: 'appId = :appId' ,
        ExpressionAttributeValues: {
            ':appId': appId,
        },
    };

    try {
        console.log('Fetching message limits for appId:', appId);
        const returnData = await docClient.scan(params).promise();
        return returnData.Items;
    } catch (error) {
        console.error('Error fetching company message limits:', error);
        throw new Error('Error fetching company message limits');
    }
};


