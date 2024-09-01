const AWS = require("aws-sdk");
const {responseStatus} = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.updateSenderEmail = async (event) => {
    const requestBody = JSON.parse(event.body);
    const { smtpHost, smtpPort, smtpUser, smtpPass, appId } = requestBody;

    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !appId) {
        return responseStatus(400,'All fields are required')
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
            return responseStatus(404,'Not found with the given id')
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
        return responseStatus(200,"SMTP configuration updated successfully." + updateResult.Attributes)
    } catch (error) {
        console.error("Error updating SMTP configuration:", error);
        return responseStatus(500,"Error updating SMTP configuration: " +  error)
    }
};
