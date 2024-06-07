const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");

const docClient = new AWS.DynamoDB.DocumentClient();

exports.saveSmtpConfig = async (event) => {
    const requestBody = JSON.parse(event.body);

    const { smtpHost, smtpPort, smtpUser, smtpPass, appId } = requestBody;

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !appId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "All fields are required." }),
        };
    }

    const params = {
        TableName: process.env.SMTP_TABLE,
        Item: {
            id: uuidv4(),
            appId: appId,
            host: smtpHost,
            port: smtpPort,
            user: smtpUser,
            pass: smtpPass,
            createdAt: Math.floor(new Date().getTime() / 1000),
            updatedAt: Math.floor(new Date().getTime() / 1000)
        }
    };

    try {
        await docClient.put(params).promise();
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "SMTP configuration saved successfully." }),
        };
    } catch (error) {
        console.error("Error saving SMTP configuration:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error" }),
        };
    }
};