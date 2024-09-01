const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const { responseStatus } = require('../../utils/response');

exports.fetchEmailCredits = async (event) => {
    try {
        const emailCredits = await getEmailCredits();
        return responseStatus(200, emailCredits);
    } catch (error) {
        return responseStatus(500, {
            message: error.message,
        });
    }
};

const getEmailCredits = async () => {
    const params = {
        TableName: process.env.SMPL_CREDITS,
        Key: { type: 'EMAIL' },
    };

    try {
        console.log('Fetching current EMAIL credits');
        const returnData = await docClient.get(params).promise();
        return returnData.Item;
    } catch (error) {
        console.error('Error fetching EMAIL credits:', error);
        throw new Error('Error fetching EMAIL credits');
    }
};