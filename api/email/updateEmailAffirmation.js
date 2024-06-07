const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();

// 1x1 PNG pixel (base64 encoded)
const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAgEBAYHdRxMAAAAASUVORK5CYII=",
    "base64"
);

exports.updateEmailAffirmation = async (event, context) => {
    const { emailId } = event.queryStringParameters || {};

    if (!emailId) {
        return {
            statusCode: 400,
            headers: {
                "Content-Type": "text/plain"
            },
            body: "Missing emailId!"
        };
    }

    try {
        // EmailId'ye denk gelen veriyi güncelle
        await updateEmailAffirmation(emailId);
        return {
            statusCode: 200,
            headers: {
                "Content-Type": "image/png",
                "Content-Length": pixel.length
            },
            body: pixel.toString("base64"),
            isBase64Encoded: true
        };
    } catch (err) {
        console.error("Error updating email affirmation: ", err);
        return {
            statusCode: 500,
            headers: {
                "Content-Type": "text/plain"
            },
            body: err.message
        };
    }
};

const updateEmailAffirmation = async (emailId) => {
    const now = Math.floor(Date.now() / 1000); // Şu anki zamanı saniye cinsinden al
    const params = {
        TableName: process.env.EMAIL_LOGS_TABLE,
        Key: { id: emailId },
        UpdateExpression: "set #affirmation = :status, #updatedAt = :now",
        ExpressionAttributeNames: {
            "#affirmation": "affirmation",
            "#updatedAt": "updatedAt"
        },
        ExpressionAttributeValues: {
            ":status": "opened",
            ":now": now
        },
        ReturnValues: "UPDATED_NEW"
    };

    try {
        const result = await docClient.update(params).promise();
        console.log("Update result: ", result);
        return result;
    } catch (err) {
        console.error("Error updating item in DynamoDB: ", err);
        throw err;
    }
};
