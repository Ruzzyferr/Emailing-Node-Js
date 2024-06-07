const AWS = require("aws-sdk");
const { responseStatus } = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.updateEmail = async (event, context, callback) => {
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

        if (!emailData.isScheduled) {
            console.error("Email with the given emailId is not scheduled");
            return responseStatus(400, "Email is not scheduled");
        }

        const updatedEmail = await updateEmailContent(emailData, event.body);

        return responseStatus(200, updatedEmail);
    } catch (err) {
        console.error("Error updating email:", err);
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

const updateEmailContent = async (emailData, newContent) => {
    // Parse the new content
    const newEmailContent = JSON.parse(newContent);

    // Update email data with new content
    emailData.appId = newEmailContent.appId;
    emailData.body = newEmailContent.body;
    emailData.clickAction = newEmailContent.clickAction;
    emailData.html = newEmailContent.html;
    emailData.subject = newEmailContent.subject;
    emailData.scenarioId = newEmailContent.scenarioId;
    emailData.topicName = newEmailContent.topicName;
    emailData.isScheduled = true;

    if (newEmailContent.emailList && newEmailContent.emailList.length > 0) {
        emailData.emailList = newEmailContent.emailList;
    }

    emailData.emailListName = newEmailContent.emailListName;
    emailData.scheduledDate = newEmailContent.scheduledDate;
    emailData.type = newEmailContent.type;
    emailData.createdBy = newEmailContent.createdBy;
    emailData.updatedBy = newEmailContent.updatedBy;
    emailData.updatedAt = Date.now();


    // Update the email in the database
    const params = {
        TableName: process.env.EMAIL_TABLE,
        Item: emailData
    };

    try {
        await docClient.put(params).promise();
        return emailData;
    } catch (err) {
        console.error("Failed to update email in DynamoDB:", err);
        throw new Error("Failed to update email in database");
    }
};
