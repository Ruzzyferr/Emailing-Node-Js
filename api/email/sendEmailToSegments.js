const nodemailer = require('nodemailer');
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const {responseStatus} = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

const smtpConfig = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
};

const appIdCounters = {};
const resetDates = {};

const edenredID = "c8ea4f4c-6137-4d7a-9f6d-2bffa61cdcf7"
const MAX_DAILY_EMAILS = {
    [edenredID]: 300 //edenred
};

exports.sendEmailToTopicMembers = async (event, context, callback) => {
    console.log(event);
    const requestBody = JSON.parse(event.body);
    const mailOptions = {
        from: requestBody.from,
        to: '',
        subject: requestBody.subject,
        html: requestBody.html
    };

    try {
        const {appId} = requestBody;
        if (appId === edenredID) {
            if (!appIdCounters.hasOwnProperty(requestBody.appId)) {
                appIdCounters[requestBody.appId] = 0;
            }

            if (!resetDates.hasOwnProperty(requestBody.appId) || isResetNeeded(requestBody.appId)) {
                resetCounters(requestBody.appId);
            }
            if (appIdCounters[requestBody.appId] >= MAX_DAILY_EMAILS[requestBody.appId]) {
                console.error(`Daily email quota exceeded for appId: ${requestBody.appId}`);
                return responseStatus(400, `Daily email quota exceeded for appId: ${requestBody.appId}`);
            }
            appIdCounters[requestBody.appId] += 1;
        }

        const topicMails = await getTopicMails(requestBody.appId, requestBody.topicName);
        if (!topicMails) {
            throw new Error('Topic not found.');
        }

        const failedEmails = [];
        const nowDate = Math.floor(new Date().getTime() / 1000);
        const emailLogs = []; // Boş bir array oluştur

        await Promise.all(topicMails.map(async (mail) => {
            const customizedOptions = {...mailOptions, to: mail};
            const emailLog = {
                id: uuidv4(),
                emailId: '', // emailId'yi burada ayarlamayacağız
                appId: requestBody.appId,
                createdAt: nowDate,
                updatedAt: nowDate,
                affirmation: '',
                recipient: mail
            };

            try {
                if (!requestBody.isScheduled) {
                    await sendEmail(customizedOptions);
                    emailLog.affirmation = 'received';
                }
            } catch (error) {
                console.error(`Failed to send email to ${mail}:`, error);
                failedEmails.push({emailId: '', recipient: mail});
            }

            emailLogs.push(emailLog); // Her bir emailLog'u emailLogs array'ine ekle
        }));



        // submitEmailTable fonksiyonunu çağırınca dönen emailId'yi alarak emailLogs içindeki her bir emailLog'un emailId'sini ayarlayın
        const emailTableId = await submitEmailTable(requestBody, topicMails.length - failedEmails.length);
        const trimmedString = emailTableId.body.substring(1, emailTableId.body.length - 1);
        emailLogs.forEach(log => log.emailId = trimmedString);

        for (const failedEmail of failedEmails) {
            try {
                failedEmail.affirmation = 'failed';
                await saveFailedEmail(trimmedString, failedEmail.recipient);
            } catch (error) {
                console.error("Error saving failed email:", error);
            }
        }
        // Toplu olarak emailLogs array'ini veritabanına kaydedin
        await saveEmailLogs(emailLogs);

        return responseStatus(200, 'Emails successfully sent to all members.');
    } catch (error) {
        console.error('Error sending emails to all members:', error);
        throw error;
    }
}


function isResetNeeded(appId) {
    const now = new Date();
    const resetDate = resetDates[appId];
    return !resetDate || now.getDate() !== resetDate.getDate();
}

function resetCounters(appId) {
    appIdCounters[appId] = 0;
    resetDates[appId] = new Date();
}


async function sendEmail(mailOptions) {
    const transporter = nodemailer.createTransport(smtpConfig);

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent:', info.messageId);
        return info;
    } catch (error) {
        console.error('Failed to send email:', error);
        throw error;
    }
}


async function getTopicMails(appId, topicName) {
    const params = {
        TableName: process.env.TOKEN_TABLE,
        FilterExpression: "#topicName = :topicValue and #appId = :appValue and attribute_exists(emails)",
        ExpressionAttributeValues: {
            ":topicValue": topicName,
            ":appValue": appId
        },
        ExpressionAttributeNames: {
            "#topicName": "topicName",
            "#appId": "appId"
        },
    };

    try {
        const data = await docClient.scan(params).promise();
        const mails = data.Items.map(item => item.emails);
        console.log("Token table data ----------: " + mails);
        return mails.map(emails => emails[0]);
    } catch (error) {
        console.error("Error retrieving topic mails:", error);
        throw error;
    }
}


async function submitEmailTable(data, totalSent) {
    const nowDate = Math.floor(new Date().getTime() / 1000);
    console.log("DATA:" + data.subject);
    const params = {
        TableName: process.env.EMAIL_TABLE,
        Item: {
            emailId: uuidv4(),
            appId: data.appId,
            subject: data.subject,
            html: data.html,
            clickAction: data.clickAction ? data.clickAction : "",
            topicName: data.topicName,
            totalSent: totalSent,
            closed: 0,
            opened: 0,
            received: totalSent,
            isActive: true,
            isScheduled: data.isScheduled,
            scheduledDate: data.scheduledDate ? data.scheduledDate : "",
            createdAt: nowDate,
            updatedAt: nowDate,
            type:'',
        },
        ReturnValues: "ALL_OLD"
    };

    console.log("Submitting to DB table...");
    const returnData = await docClient.put(params).promise();
    console.log("EMAILID: " + params.Item.emailId);
    return responseStatus(200, params.Item.emailId);
}

async function saveEmailLogs(emailLogs) {
    // emailLogs içindeki her bir emailLog'u veritabanına kaydetmek için toplu işlem yapabilirsiniz
    const params = {
        RequestItems: {
            [process.env.EMAIL_LOGS_TABLE]: emailLogs.map(log => ({
                PutRequest: {
                    Item: log
                }
            }))
        }
    };

    try {
        await docClient.batchWrite(params).promise();
        console.log("Email logs saved successfully.");
    } catch (err) {
        console.error("Error saving email logs:", err);
        throw err;
    }
}

const saveFailedEmail = async (emailId, recipient) => {
    const params = {
        TableName: process.env.EMAIL_LOGS_TABLE,
        Item: {
            emailId: emailId,
            recipient: recipient,
            status: 'Failed',
            timestamp: Date.now()
        }
    };

    try {
        await docClient.put(params).promise();
        console.log("Failed email saved successfully.");
    } catch (err) {
        console.error("Error saving failed email:", err);
        throw err;
    }
};
