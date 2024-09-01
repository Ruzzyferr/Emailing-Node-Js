const AWS = require("aws-sdk");
const {responseStatus} = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.getSenderEmail = async (event, context) => {
    const requestBody = JSON.parse(event.body);
    const { appId } = event.queryStringParameters; // appId'yi parametrelerden al
    console.log("BODY: " + event.body);

    if (!appId) {
        return responseStatus(400,'App id is required');
    }

    const queryParams = {
        TableName: process.env.SENDER_EMAIL_TABLE,
        FilterExpression: "appId = :appId",
        ExpressionAttributeValues: {
            ":appId": appId
        }
    };

    try {
        const queryResult = await docClient.scan(queryParams).promise();

        if (queryResult.Items.length === 0) {
            return responseStatus(404,"SMTP configuration not found for the given appId")
        }

        const smtpConfig = queryResult.Items;

        return responseStatus(200 , smtpConfig);
    } catch (error) {
        console.error("Error retrieving SMTP configuration:", error);
        return responseStatus(500,"Internal Server Error \n" + error.message)
    }
};

