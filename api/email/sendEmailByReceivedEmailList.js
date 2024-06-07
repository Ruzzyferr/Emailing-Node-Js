const nodemailer = require('nodemailer');
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const {responseStatus} = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();
const axios = require('axios');
const cheerio = require("cheerio");

const smtpConfig = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
};

const CHUNK_SIZE = 100;

exports.sendEmailByReceivedEmailList = async (event, context, callback) => {
    console.log(event);
    const requestBody = JSON.parse(event.body);
    console.log("FROM: " + requestBody.from);
    const { html, links } = extractLinks(requestBody.html);
    const mailOptions = {
        from: requestBody.from,
        to: '',
        subject: requestBody.subject,
        html: requestBody.html,
    };

    try {
        const { appId, emailList } = requestBody;

        if (!emailList || emailList.length === 0) {
            return responseStatus(400, 'Email list is empty.');
        }

        const smtpConfig = await getSmtpConfig(appId);

        if(smtpConfig.statusCode === 404){
            return { statusCode: 404, body: `SMTP configuration not found for appId: ${appId}` };
        }

        const {isScheduled, scheduledDate } = requestBody;

        if (isScheduled && scheduledDate) {

            await submitEmailTable(requestBody, 0, emailList.length, emailList);
            return responseStatus(200, 'Email scheduled successfully.');
        }

        const nowDate = Math.floor(new Date().getTime() / 1000);
        const emailLogs = [];

        const consentedEmails = await checkIYSConsentList(emailList);

        // Separate non-consented emails
        const nonConsentedEmails = emailList.filter(email => !consentedEmails.includes(email));

        // Send emails in chunks of 100
        let totalSent = 0;
        for (let startIndex = 0; startIndex < consentedEmails.length; startIndex += CHUNK_SIZE) {
            const chunk = consentedEmails.slice(startIndex, startIndex + CHUNK_SIZE);
            const customizedOptions = { ...mailOptions, bcc: chunk };
            await sendEmail(customizedOptions, smtpConfig);
            totalSent += chunk.length;

            // Log delivered emails
            chunk.forEach(mail => {
                emailLogs.push({
                    id: uuidv4(),
                    emailId: requestBody.emailId,
                    appId: appId,
                    createdAt: nowDate,
                    updatedAt: nowDate,
                    affirmation: 'delivered',
                    recipient: mail
                });
            });
        }

        // Log IYS failed emails
        nonConsentedEmails.forEach(mail => {
            emailLogs.push({
                id: uuidv4(),
                emailId: requestBody.emailId,
                appId: appId,
                createdAt: nowDate,
                updatedAt: nowDate,
                affirmation: 'iys failed',
                recipient: mail
            });
        });

        // Save email logs
        if (emailLogs.length > 0) {
            await saveEmailLogs(emailLogs);
        }

        // Submit email table
        const emailTableId = await submitEmailTable(requestBody, totalSent, emailList.length);

        // Log links
        const trimmedString = emailTableId.body.substring(1, emailTableId.body.length - 1);
        await logLinks(links, trimmedString);

        return responseStatus(200, 'Emails sent successfully.');
    } catch (error) {
        console.error('Error sending emails: ', error);
        throw error;
    }
};



async function sendEmail(mailOptions, smtpConfig) {
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


async function submitEmailTable(data, totalSent, totalDestination) {
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
            opened: 0,
            delivered: totalSent,
            totalDestination: totalDestination,
            isActive: true,
            isScheduled: data.isScheduled,
            scheduledDate: data.scheduledDate ? data.scheduledDate : "",
            createdAt: nowDate,
            updatedAt: nowDate,
            type: data.type,
            updatedBy: data.updatedBy,
            createdBy: data.createdBy,
            emailList: data.emailList,
            emailListName: data.emailListName
        },
        ReturnValues: "ALL_OLD"
    };

    console.log("Submitting to DB table...");
    const returnData = await docClient.put(params).promise();
    console.log("EMAILID: " + params.Item.emailId);
    return responseStatus(200, params.Item.emailId);
}


async function saveEmailLogs(emailLogs) {
    if (emailLogs.length === 0) {
        console.log("No email logs to save.");
        return;
    }

    const batchSize = 25;
    const emailLogBatches = [];

    // Email loglarını batchSize'e göre parçalara ayır
    for (let i = 0; i < emailLogs.length; i += batchSize) {
        emailLogBatches.push(emailLogs.slice(i, i + batchSize));
    }

    // Her bir parça için kaydetme işlemini gerçekleştir
    for (const batch of emailLogBatches) {
        const params = {
            RequestItems: {
                [process.env.EMAIL_LOGS_TABLE]: batch.map(log => ({
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

async function checkIYSConsentList(emails) {
    const IYS_API_URL = process.env.IYS_API_URL; // İYS API URL
    const IYS_API_KEY = process.env.IYS_API_KEY; // İYS API key

    try {
        const response = await axios.post(IYS_API_URL + '/consent/multiple/status', {

            recipients: emails,
            recipientType: "BIREYSEL",
            type: "EPOSTA",
            iysCode: 699905,
            brandCode: 699905
        }, {
            headers: {
                "IYS-API-KEY": IYS_API_KEY,
                "Content-Type": "application/json"
            }
        });

        console.log("Response: +++ " + response.data)
        // Assuming response.data is an array of consent statuses
        return response.data.data.list;
    } catch (error) {
        console.error('IYS consent list check error:', error);
        throw new Error(`IYS consent list check error: ${error.message}`);
    }
}


function extractLinks(html) {
    const $ = cheerio.load(html);
    const links = [];
    $('a').each((index, element) => {
        const href = $(element).attr('href');
        if (href && isProductLink(href)) {
            const id = uuidv4();
            links.push({ id, href });
            $(element).attr('href', `${process.env.CLICK_ENDPOINT_URL}${id}`);
        }
    });

    console.log("Oluşturulan linkler:");
    links.forEach(link => {
        console.log(`ID: ${link.id}, Href: ${link.href}`);
    });

    return { html: $.html(), links };
}

function isProductLink(link) {
    // Placeholder for actual product link check
    return true;
}

async function logLinks(links, emailId) {
    if (links.length === 0) {
        console.log("No links to log.");
        return;
    }

    const batchSize = 25;
    const linkBatches = [];


    for (let i = 0; i < links.length; i += batchSize) {
        linkBatches.push(links.slice(i, i + batchSize));
    }


    for (const batch of linkBatches) {
        const nowDate = Math.floor(new Date().getTime() / 1000);
        const linkLogs = batch.map(link => ({
            id: link.id,
            emailId: emailId,
            Link: link.href,
            clickCount: 0,
            createdAt: nowDate,
            updatedAt: nowDate
        }));

        const params = {
            RequestItems: {
                [process.env.LINK_INFO_LOG_TABLE]: linkLogs.map(log => ({
                    PutRequest: {
                        Item: log
                    }
                }))
            }
        };

        try {
            await docClient.batchWrite(params).promise();
            console.log("links logged successfully.");
        } catch (err) {
            console.error("Error logging links:", err);
            throw err;
        }
    }
}

async function getSmtpConfig(appId) {
    const params = {
        TableName: process.env.SMTP_TABLE,
        FilterExpression: 'appId = :appId',
        ExpressionAttributeValues: { ':appId': appId }
    };

    try {
        const result = await docClient.scan(params).promise();
        if (result.Items.length === 0) {
            return { statusCode: 404, body: `SMTP configuration not found for appId: ${appId}` };
        }

        const smtpConfig = result.Items[0];
        return {
            host: smtpConfig.host,
            port: smtpConfig.port,
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.pass
            }
        };
    } catch (error) {
        console.error('Error fetching SMTP configuration:', error);
        throw error;
    }
}

