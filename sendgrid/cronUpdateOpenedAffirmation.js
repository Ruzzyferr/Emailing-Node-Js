const AWS = require('aws-sdk');
const axios = require('axios');
const docClient = new AWS.DynamoDB.DocumentClient();
const sendGridApiKey = process.env.SENDGRID_API_KEY;
const { responseStatus } = require("../../utils/response");

exports.handler = async (event) => {
    const today = new Date();
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(today.getDate() - 30);

    const emailId = event.queryStringParameters.emailId;

    const startDate = oneWeekAgo.toISOString().split('T')[0] + 'T00:00:00.000Z';
    const endDate = today.toISOString().split('T')[0] + 'T23:59:59.999Z';

    try {
        // 1. EMAIL_TABLE'dan emailId'ye göre verileri çek
        const emailTableData = await getEmailsByEmailId(emailId);

        // 2. SendGrid API'den tarih aralığına göre verileri çek
        const sendGridData = await getSendGridMessages(startDate, endDate, sendGridApiKey);

        if (sendGridData.length === 0) {
            return responseStatus(200, "SMTP Config successfully received")
        }

        // 3. Eşleşen veriler için EMAIL_LOGS_TABLE'ı güncelle
        for (const email of emailTableData) {
            const sendGridMessages = sendGridData.filter(msg => msg.msg_id.startsWith(email.sendGridMessageId));
            console.log("SENDGRID DATA: " + JSON.stringify(sendGridMessages.map(msg => msg.to_email)));

            for (const sendGridMessage of sendGridMessages) {
                console.log("EMAILID: " + email.emailId + "\nFROMEMAIL: " + sendGridMessage.to_email);
                if (sendGridMessage.opens_count > 0) {
                    await updateEmailLogs(email.emailId, sendGridMessage.to_email);
                }
            }
        }

        // 4. Güncellenen logları çek ve EMAIL_TABLE'ı güncelle
        const updatedLogs = await getUpdatedLogsByEmailId(emailId);
        const openedCount = updatedLogs.length;
        await updateEmailTableWithOpenedCount(emailId, openedCount);


            return responseStatus(200,'Opened email information recorded in the database.')

    } catch (error) {
        console.error('Error processing emails: ', error);
        return responseStatus(500, error.message)
    }
};

async function getEmailsByEmailId(emailId) {
    const params = {
        TableName: process.env.EMAIL_TABLE,
        FilterExpression: 'emailId = :emailId',
        ExpressionAttributeValues: {
            ':emailId': emailId,
        },
    };

    const data = await docClient.scan(params).promise();
    return data.Items;
}

async function getSendGridMessages(startDate, endDate, sendGridApiKey) {
    const queryParams = {
        limit: 1000,
        query: `last_event_time BETWEEN TIMESTAMP "${new Date(startDate).toISOString()}" AND TIMESTAMP "${new Date(endDate).toISOString()}"`,
    };

    const requestConfig = {
        method: 'get',
        url: 'https://api.sendgrid.com/v3/messages',
        headers: {
            'Authorization': `Bearer ${sendGridApiKey}`,
        },
        params: queryParams,
    };

    try {
        const response = await axios(requestConfig);
        return response.data.messages;
    } catch (error) {
        console.error('Error in getSendGridMessages: ', error.response ? error.response.data : error.message);
        throw new Error(error.response ? error.response.data : error.message);
    }
}

async function getEmailLogsByEmailId(emailId, toEmail) {
    const params = {
        TableName: process.env.EMAILS_LOGS_TABLE,
        FilterExpression: 'emailId = :emailId and recipient = :toEmail',
        ExpressionAttributeValues: {
            ':emailId': emailId,
            ':toEmail': toEmail,
        },
    };

    try {
        const data = await docClient.scan(params).promise();
        return data.Items;
    } catch (error) {
        console.error('Error fetching email logs: ', error);
        throw new Error(error.message);
    }
}

async function updateEmailLogsBatch(emailLogsBatch, toEmail) {
    const batchPromises = emailLogsBatch.map(log => {
        const params = {
            TableName: process.env.EMAILS_LOGS_TABLE,
            Key: {
                id: log.id,
            },
            UpdateExpression: 'set affirmation = :status',
            ExpressionAttributeValues: {
                ':status': 'opened',
                ':toEmail': toEmail,
            },
            ConditionExpression: 'recipient = :toEmail', // Filtreleme koşulu
        };

        return docClient.update(params).promise();
    });

    try {
        await Promise.all(batchPromises);

        emailLogsBatch.forEach(log => {
            console.log(`Email logs updated for emailId ${log.emailId} with Email ${toEmail}`);
        });
    } catch (error) {
        console.error('Error updating email logs batch: ', error);
        throw new Error(error.message);
    }
}

async function updateEmailLogs(emailId, toEmail) {
    try {
        console.log("EMAIL_LOGS: " + emailId + toEmail);
        const emailLogs = await getEmailLogsByEmailId(emailId, toEmail);

        const batchSize = 25; // Her bir batch'te işlenecek öğe sayısı
        for (let i = 0; i < emailLogs.length; i += batchSize) {
            const batch = emailLogs.slice(i, i + batchSize);
            await updateEmailLogsBatch(batch, toEmail);
        }
    } catch (error) {
        console.error('Error updating email logs: ', error);
        throw new Error('Failed to update email logs');
    }
}

async function getUpdatedLogsByEmailId(emailId) {
    const params = {
        TableName: process.env.EMAILS_LOGS_TABLE,
        FilterExpression: 'emailId = :emailId and affirmation = :status',
        ExpressionAttributeValues: {
            ':emailId': emailId,
            ':status': 'opened',
        },
    };

    try {
        const data = await docClient.scan(params).promise();
        return data.Items;
    } catch (error) {
        console.error('Error fetching updated email logs: ', error);
        throw new Error(error.message);
    }
}

async function updateEmailTableWithOpenedCount(emailId, openedCount) {
    const params = {
        TableName: process.env.EMAIL_TABLE,
        Key: {
            emailId: emailId,
        },
        UpdateExpression: 'set opened = :count',
        ExpressionAttributeValues: {
            ':count': openedCount,
        },
    };

    try {
        await docClient.update(params).promise();
        console.log(`EMAIL_TABLE updated with opened for emailId ${emailId}`);
    } catch (error) {
        console.error('Error updating EMAIL_TABLE: ', error);
        throw new Error(error.message);
    }
}
