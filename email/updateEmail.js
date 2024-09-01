const AWS = require("aws-sdk");
const { responseStatus } = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.updateEmail = async (event, context, callback) => {
    const emailId = event.queryStringParameters?.emailId;

    const requestBody = JSON.parse(event.body);

    if (!emailId) {
        console.error("EmailId is empty");
        return responseStatus(400, "EmailId is required");
    }

    try {
        const emailData = await getEmailById(emailId);

        console.log(emailData);

        if (!emailData) {
            console.error("Email not found for the given emailId");
            return responseStatus(404, "Email not found");
        }
        let emailListToCheck = [];

        console.log("UPDATE LIST:" + requestBody.emailList);

        if (requestBody.emailList && requestBody.emailList.length > 0) {
            emailListToCheck = requestBody.emailList;
        }else {
            emailListToCheck = await getTopicMails(requestBody.appId, requestBody.topicName);
        }

        const { limitCheckResult, remainingLimit } = await checkEmailSendingLimit(requestBody.appId, emailListToCheck.length);
        if (!limitCheckResult) {
            return responseStatus(400, `Not enough email limit. Total limit: ${remainingLimit.total}, Remaining limit: ${remainingLimit.remaining}`);
        }

        // Update email content with new data
        const updatedEmail = await updateEmailContent(emailData, event.body);



        await updateEmailInDatabase(updatedEmail, emailId);

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
    emailData.from = newEmailContent.from;
    emailData.isScheduled = true;
    emailData.iysCheck = true;

    if (newEmailContent.emailList && newEmailContent.emailList.length > 0) {
        emailData.emailList = newEmailContent.emailList;
    }

    emailData.emailListName = newEmailContent.emailListName;
    emailData.scheduledDate = newEmailContent.scheduledDate; // Unix zaman damgası
    emailData.type = newEmailContent.type;
    emailData.createdBy = newEmailContent.createdBy;
    emailData.updatedBy = newEmailContent.updatedBy;
    emailData.updatedAt = Math.floor(new Date().getTime() / 1000);

    return emailData;
};

const updateEmailInDatabase = async (emailData, emailId) => {
    const params = {
        TableName: process.env.EMAIL_TABLE,
        Item: emailData,
        ConditionExpression: "emailId = :emailId", // Önceki emailId ile eşleşmeli
        ExpressionAttributeValues: {
            ":emailId": emailId // Önceki emailId değeri
        }
    };

    try {
        await docClient.put(params).promise();
        return emailData;
    } catch (err) {
        console.error("Failed to update email in DynamoDB:", err);
        throw new Error("Failed to update email in database");
    }
};

async function getTopicMails(appId, topicName) {
    try {
        // İstek URL'sini oluşturuyoruz
        const response = await axios.get(`https://fhzv8kneyd.execute-api.eu-north-1.amazonaws.com/dev/push/dashboard/segments/getEmailsBySegment`, {
            params: {
                id: appId,
                segment: topicName
            }
        });

        if (response.status !== 200) {
            throw new Error(`Failed to retrieve emails. Status code: ${response.status}`);
        }

        const mails = response.data.emails;
        console.log("Emails retrieved from segment:", mails);
        return mails;
    } catch (error) {
        console.error("Error retrieving topic mails:", error);
        throw error;
    }
}

async function checkEmailSendingLimit(appId, emailCount) {
    const params = {
        TableName: process.env.COMPANY_MESSAGE_LIMITS_TABLE,
        FilterExpression: "#appId = :appIdValue and #type = :typeValue",
        ExpressionAttributeValues: {
            ":appIdValue": appId,
            ":typeValue": "EMAIL"
        },
        ExpressionAttributeNames: {
            "#appId": "appId",
            "#type": "type"
        }
    };

    try {
        const result = await docClient.scan(params).promise();
        if (!result.Items[0]) {
            return { limitCheckResult: false, remainingLimit: { total: 0, used: 0, remaining: 0 } };
        }

        const limit = result.Items[0].limit;
        const used = result.Items[0].used;
        const remaining = limit - used;

        if (remaining < emailCount) {
            return { limitCheckResult: false, remainingLimit: { total: limit, used: used, remaining: remaining } };
        }

        return { limitCheckResult: true, remainingLimit: { total: limit, used: used, remaining: remaining } };
    } catch (error) {
        console.error('Error checking email sending limit:', error);
        throw error;
    }
}
