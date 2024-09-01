const AWS = require("aws-sdk");
const {responseStatus} = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.deleteSenderEmail = async (event) => {
    const requestBody = JSON.parse(event.body);
    const { id } = requestBody;

    if (!id) {
        return responseStatus(400,'id needed')
    }

    const queryParams = {
        TableName: process.env.SENDER_EMAIL_TABLE,
        FilterExpression: "id = :id",
        ExpressionAttributeValues: {
            ":id": id
        }
    };

    try {
        const queryResult = await docClient.scan(queryParams).promise();

        if (queryResult.Items.length === 0) {
            return responseStatus(404,'Not found with given id')
        }

        const smtpConfig = queryResult.Items[0];

        const deleteParams = {
            TableName: process.env.SMTP_TABLE,
            Key: { id: smtpConfig.id }
        };

        await docClient.delete(deleteParams).promise();
        return responseStatus(200,'Deleted successfully')
    } catch (error) {
        console.error("Error deleting SMTP configuration:", error);
        return responseStatus(500,'Internal Server Error')
    }
};
