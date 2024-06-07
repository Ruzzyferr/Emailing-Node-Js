const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.getSmtpConfig = async (event) => {
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

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "SMTP configuration retrieved successfully.", smtpConfig }),
        };
    } catch (error) {
        console.error("Error retrieving SMTP configuration:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error" }),
        };
    }
};
