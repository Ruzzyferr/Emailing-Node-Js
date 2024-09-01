const AWS = require("aws-sdk");
const { responseStatus } = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.deleteEmail = async (event, context, callback) => {
    const emailId = event.queryStringParameters?.emailId;

    if (!emailId) {
        console.error("EmailId is empty");
        return responseStatus(400, "EmailId is required");
    }

    try {
        const emailData = await getEmailById(emailId);

        if (!emailData) {
            console.error("Email not found for the given emailId");
            return responseStatus(404, "Email not found");
        }

        if(!emailData.isScheduled){
            console.error("Email found that is not scheduled");
            return responseStatus(404, "Email is not scheduled");
        }

        await deleteEmailById(emailId);

        return responseStatus(200, "Email deleted successfully");
    } catch (err) {
        console.error("Error deleting email:", err);
        return responseStatus(500, err.message || "Internal Server Error");
    }
};

const getEmailById = async (emailId) => {
    const params = {
        TableName: process.env.EMAIL_TABLE,
        Key: {
            emailId: emailId,
        }
    };

    try {
        const data = await docClient.get(params).promise();
        return data.Item ? data.Item : null;
    } catch (err) {
        console.error("Failed to fetch data from DynamoDB:", err);
        throw new Error("Failed to fetch email from database");
    }
};

const deleteEmailById = async (emailId) => {
    const params = {
        TableName: process.env.EMAIL_TABLE,
        Key: {
            emailId: emailId,
        }
    };

    try {
        await docClient.delete(params).promise();
    } catch (err) {
        console.error("Failed to delete email from DynamoDB:", err);
        throw new Error("Failed to delete email from database");
    }
};
