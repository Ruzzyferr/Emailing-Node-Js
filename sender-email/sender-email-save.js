const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const {responseStatus} = require("../../utils/response");

const docClient = new AWS.DynamoDB.DocumentClient();

exports.saveSenderEmail = async (event) => {
    const requestBody = JSON.parse(event.body);

    const { email, appId } = requestBody;

    if (!email || !appId) {
        return responseStatus(400,'All fields are required')
    }

    const params = {
        TableName: process.env.SENDER_EMAIL_TABLE,
        Item: {
            id: uuidv4(),
            appId: appId,
            email: email,
            createdAt: Math.floor(new Date().getTime() / 1000),
            updatedAt: Math.floor(new Date().getTime() / 1000)
        }
    };

    try {
        await docClient.put(params).promise();
        return responseStatus(200,'Saved Successfully')
    } catch (error) {
        console.error("Error saving SMTP configuration:", error);
        return responseStatus(500,'Internal Server Error')
    }
};