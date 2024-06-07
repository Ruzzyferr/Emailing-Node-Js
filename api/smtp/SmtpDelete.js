const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.deleteSmtpConfig = async (event) => {
    const requestBody = JSON.parse(event.body);
    const { appId } = requestBody;

    if (!appId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "appId is required." }),
        };
    }

    const queryParams = {
        TableName: process.env.SMTP_TABLE,
        FilterExpression: "appId = :appId",
        ExpressionAttributeValues: {
            ":appId": appId
        }
    };

    try {
        const queryResult = await docClient.scan(queryParams).promise();

        if (queryResult.Items.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "SMTP configuration not found for the given appId." }),
            };
        }

        const smtpConfig = queryResult.Items[0];

        const deleteParams = {
            TableName: process.env.SMTP_TABLE,
            Key: { id: smtpConfig.id }
        };

        await docClient.delete(deleteParams).promise();
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "SMTP configuration deleted successfully." }),
        };
    } catch (error) {
        console.error("Error deleting SMTP configuration:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error" }),
        };
    }
};
