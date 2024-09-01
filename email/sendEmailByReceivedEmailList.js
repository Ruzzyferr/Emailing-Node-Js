const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const { responseStatus } = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();
const axios = require('axios');
const sgMail = require('@sendgrid/mail');
const cheerio = require("cheerio");


sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.sendEmailByReceivedEmailList = async (event, context, callback) => {
    console.log(event);
    const requestBody = JSON.parse(event.body);

    const emailIdCreated = uuidv4();
    console.log("EMAIL CREATED: " + emailIdCreated);

    const { html, links } = extractLinks(requestBody.html);

    const mailOptions = {
        from: requestBody.from,
        to: '',
        subject: requestBody.subject,
        html: html,
    };

    try {
        let { appId, emailList, iysCheck } = requestBody;

        iysCheck = true;

        if (!emailList || emailList.length === 0) {
            return responseStatus(400, 'Email list is empty.');
        }

        const { limitCheckResult, remainingLimit } = await checkEmailSendingLimit(appId, emailList.length);
        if (!limitCheckResult) {
            return responseStatus(400, `Not enough email limit. Total limit: ${remainingLimit.total}, Remaining limit: ${remainingLimit.remaining}`);
        }

        const { isScheduled, scheduledDate } = requestBody;

        if (isScheduled && scheduledDate) {
            await submitEmailTable(emailIdCreated, requestBody, 0, emailList.length, scheduledDate);
            return responseStatus(200, 'Email was successfully scheduled. Your remaining email usage allowance: ' + (remainingLimit.remaining - emailList.length));
        }

        const nowDate = Math.floor(new Date().getTime() / 1000);
        const emailLogs = [];
        let consentedEmails;

        if (iysCheck) {
            consentedEmails = await checkIYSConsentList(appId, emailList);

            if (consentedEmails.statusCode && consentedEmails.statusCode !== 200) {
                return responseStatus(consentedEmails.statusCode, consentedEmails.body);
            }

            console.log("CONS LIST: +++" + consentedEmails);
            if (consentedEmails.length === 0) {
                return responseStatus(400, 'Emails are not consented.');
            }
        } else {
            // Eğer iysCheck false ise, tüm email listesi üzerinde işlem yap
            consentedEmails = emailList;
        }

        const chunk = consentedEmails;
        const customizedOptions = { ...mailOptions, to: chunk };
        const sendGridMessageId = await sendEmail(customizedOptions);

        chunk.forEach(mail => {
            emailLogs.push({
                id: uuidv4(),
                emailId: emailIdCreated,
                appId: appId,
                createdAt: nowDate,
                updatedAt: nowDate,
                affirmation: 'delivered',
                recipient: mail
            });
        });

        if (iysCheck) {
            const nonConsentedEmails = emailList.filter(email => !consentedEmails.includes(email));

            nonConsentedEmails.forEach(mail => {
                emailLogs.push({
                    id: uuidv4(),
                    emailId: emailIdCreated,
                    appId: appId,
                    createdAt: nowDate,
                    updatedAt: nowDate,
                    affirmation: 'iys failed',
                    recipient: mail
                });
            });
        }

        if (emailLogs.length > 0) {
            await saveEmailLogs(emailLogs);
        }

        await logLinks(links, emailIdCreated);
        await submitEmailTable(emailIdCreated, requestBody, consentedEmails.length, emailList.length, null, sendGridMessageId);
        await updateEmailSendingLimit(appId, consentedEmails.length);

        const usedPercentage = ((remainingLimit.used + consentedEmails.length) / remainingLimit.total) * 100;

        return responseStatus(200, `Emails sent successfully. Used limit: ${usedPercentage.toFixed(2)}%. Remaining emails: ${remainingLimit.remaining - consentedEmails.length}.`);
    } catch (error) {
        console.error('Error sending emails: ', error);
        throw error;
    }
};


async function sendEmail(mailOptions) {

    try {
        const response = await sgMail.sendMultiple(mailOptions);
        const sendGridMessageId = response[0].headers['x-message-id'];
        console.log('Email sent:', sendGridMessageId);
        return sendGridMessageId;
    } catch (error) {
        console.error('Failed to send email:', error);
        throw error;
    }
}


async function submitEmailTable(emailId, data,consentedEmails, totalDestination, scheduledDate, sendGridMessageId) {
    const nowDate = Math.floor(new Date().getTime() / 1000);
    console.log("DATA:" + data.subject);
    const params = {
        TableName: process.env.EMAIL_TABLE,
        Item: {
            emailId: emailId,
            appId: data.appId,
            subject: data.subject,
            html: data.html,
            clickAction: data.clickAction ? data.clickAction : "",
            topicName: data.topicName,
            opened: 0,
            delivered: consentedEmails,
            totalDestination: totalDestination,
            isActive: true,
            isScheduled: data.isScheduled,
            scheduledDate: scheduledDate ? scheduledDate : "",
            from: data.from,
            iys: true,
            createdAt: nowDate,
            updatedAt: nowDate,
            type: data.type,
            updatedBy: data.updatedBy,
            createdBy: data.createdBy,
            emailList: data.emailList,
            emailListName: data.emailListName,
            sendGridMessageId: sendGridMessageId
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

    for (let i = 0; i < emailLogs.length; i += batchSize) {
        emailLogBatches.push(emailLogs.slice(i, i + batchSize));
    }

    for (const batch of emailLogBatches) {
        const params = {
            RequestItems: {
                [process.env.EMAILS_LOGS_TABLE]: batch.map(log => ({
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

async function getAppDetails(appId) {
    const params = {
        TableName: process.env.APPS_TABLE,
        Key: { 'id': appId }
    };

    try {
        const result = await docClient.get(params).promise();
        if (!result.Item) {
            return { statusCode: 404, body: `App details not found for appId: ${appId}` };
        }

        return {
            isActive: result.Item.iys.isActive,
            iysBrandCode: result.Item.iys.iysBrandCode,
            iysCode: result.Item.iys.iysCode
        };
    } catch (error) {
        console.error('Error fetching app details:', error);
        throw error;
    }
}

async function checkIYSConsentList(appId, emails) {
    const IYS_API_URL = process.env.IYS_API_URL; // İYS API URL
    const IYS_API_KEY = process.env.IYS_API_KEY; // İYS API key
    try {
        const appDetails = await getAppDetails(appId);

        if (appDetails.statusCode === 404) {
            return { statusCode: 404, body: `App details not found for appId: ${appId}` };
        }

        if (!appDetails.isActive) {
            return { statusCode: 400, body: `Bu appId için IYS henüz aktif değildir.` };
        }

        const response = await axios.post(IYS_API_URL + '/consent/multiple/status', {
            recipients: emails,
            recipientType: "BIREYSEL",
            type: "EPOSTA",
            iysCode: appDetails.iysCode,
            brandCode: appDetails.iysBrandCode
        }, {
            headers: {
                "IYS-API-KEY": IYS_API_KEY,
                "Content-Type": "application/json"
            }
        });

        console.log("Response: +++ " + response.data);
        return response.data.data.list;
    } catch (error) {
        console.error('IYS consent list check error:', error);
        throw new Error(`IYS consent list check error: ${error.message}`);
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


async function updateEmailSendingLimit(appId, emailCount, type) {
    // İlk olarak ilgili öğeyi bulmak için scan yapıyoruz.
    const scanParams = {
        TableName: process.env.COMPANY_MESSAGE_LIMITS_TABLE,
        FilterExpression: 'appId = :appId and #type = :type',
        ExpressionAttributeNames: {
            '#type': 'type'
        },
        ExpressionAttributeValues: {
            ':appId': appId,
            ':type': 'EMAIL'
        }
    };

    try {
        const scanResult = await docClient.scan(scanParams).promise();

        if (scanResult.Items.length === 0) {
            throw new Error('Item not found');
        }

        const itemToUpdate = scanResult.Items[0];

        // Bulunan öğeyi güncellemek için update işlemi yapıyoruz.
        const updateParams = {
            TableName: process.env.COMPANY_MESSAGE_LIMITS_TABLE,
            Key: {
                // Burada öğenin birincil anahtarlarını belirtmelisiniz.
                // Örneğin:
                id: itemToUpdate.id
            },
            UpdateExpression: 'set used = used + :emailCount',
            ExpressionAttributeValues: {
                ':emailCount': emailCount
            },
            ReturnValues: 'UPDATED_NEW'
        };

        const updateResult = await docClient.update(updateParams).promise();
        console.log("Email sending limit updated:", updateResult.Attributes);
        return updateResult.Attributes;

    } catch (error) {
        console.error('Error updating email sending limit:', error);
        throw error;
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
            $(element).attr('href', `${process.env.CLICK_ENDPOINT_URL}?id=${id}`);
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



    // Linkleri batchSize'e göre parçalara ayır
    for (let i = 0; i < links.length; i += batchSize) {
        linkBatches.push(links.slice(i, i + batchSize));
    }
    const nowDate = Math.floor(new Date().getTime() / 1000);
    // Her bir parça için kaydetme işlemini gerçekleştir
    for (const batch of linkBatches) {
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
