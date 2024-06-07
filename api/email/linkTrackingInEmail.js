const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { responseStatus } = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.linkTrackingInEmail = async (event, context, callback) => {
    const { id } = event.queryStringParameters;

    try {
        const linkLog = await getLinkLogById(id);

        if (!linkLog) {
            return responseStatus(404, 'Link not found.');
        }

        await incrementClickCount(id);

        return {
            statusCode: 301,
            headers: {
                Location: linkLog.Link
            },
        };
    } catch (error) {
        console.error('Error tracking link click:', error);
        throw error;
    }
};

async function getLinkLogById(id) {
    const params = {
        TableName: process.env.LINK_INFO_LOG_TABLE,
        Key: { id }
    };

    try {
        const data = await docClient.get(params).promise();
        return data.Item;
    } catch (error) {
        console.error("Error getting link log by id:", error);
        throw error;
    }
}

async function incrementClickCount(id) {
    const params = {
        TableName: process.env.LINK_INFO_LOG_TABLE,
        Key: { id },
        UpdateExpression: 'SET clickCount = if_not_exists(clickCount, :start) + :inc',
        ExpressionAttributeValues: {
            ':inc': 1,
            ':start': 0
        },
        ReturnValues: 'UPDATED_NEW'
    };

    try {
        await docClient.update(params).promise();
        console.log(`Click count incremented for id: ${id}`);
    } catch (error) {
        console.error("Error incrementing click count:", error);
        throw error;
    }
}
