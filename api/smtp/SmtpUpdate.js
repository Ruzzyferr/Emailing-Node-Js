const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.updateSmtpConfig = async (event) => {
    const requestBody = JSON.parse(event.body);
    const { smtpHost, smtpPort, smtpUser, smtpPass, appId } = requestBody;

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !appId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "All fields are required." }),
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

        const updateParams = {
            TableName: process.env.SMTP_TABLE,
            Key: { id: smtpConfig.id },
            UpdateExpression: "set #host = :host, #port = :port, #user = :user, #pass = :pass, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#host": "host",
                "#port": "port",
                "#user": "user",
                "#pass": "pass"
            },
            ExpressionAttributeValues: {
                ":host": smtpHost,
                ":port": smtpPort,
                ":user": smtpUser,
                ":pass": smtpPass,
                ":updatedAt": Math.floor(new Date().getTime() / 1000)
            },
            ReturnValues: "UPDATED_NEW"
        };

        const updateResult = await docClient.update(updateParams).promise();
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "SMTP configuration updated successfully.", updatedAttributes: updateResult.Attributes }),
        };
    } catch (error) {
        console.error("Error updating SMTP configuration:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal Server Error" }),
        };
    }
};
