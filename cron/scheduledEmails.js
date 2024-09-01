const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const { v4: uuidv4 } = require("uuid");
const { responseStatus } = require("../../utils/response");
const axios = require("axios");
const sgMail = require("@sendgrid/mail");
const cheerio = require("cheerio");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.handler = async (event) => {
  try {
    await checkAndLogEmails();
    return { statusCode: 200, body: 'Email logs updated successfully.' };
  } catch (error) {
    console.error('Error updating email logs:', error);
    return { statusCode: 500, body: 'Error updating email logs.' };
  }
};



async function checkAndLogEmails() {
  const now = Date.now();
  const oneMinuteLater = new Date(now + (60 * 1000));

  const emails = await getPendingScheduledEmails(now, oneMinuteLater);

  for (const email of emails) {
    try {
      console.log("Checking scheduled email: ", email);

      const nowDate = Math.floor(new Date().getTime() / 1000);
      const emailLogs = [];

      let emailListToCheck = [];

      // Check if the email has emailList or emailListName
      if (email.emailList && email.emailList.length > 0 && email.emailListName) {
        emailListToCheck = email.emailList;
        console.log("LISTE OLARAK GELDİ: " + emailListToCheck.toString());
      } else {
        // If emailList is not provided, get emails by topic
        emailListToCheck = await getTopicMails(email.appId, email.topicName);
        console.log("topicName OLARAK GELDİ: " + emailListToCheck.toString());
      }

      const { limitCheckResult, remainingLimit } = await checkEmailSendingLimit(email.appId, emailListToCheck.length);
      if (!limitCheckResult) {
        return responseStatus(400, `Not enough email limit. Total limit: ${remainingLimit.total}, Remaining limit: ${remainingLimit.remaining}`);
      }

      const { html, links } = extractLinks(email.html);

      let consentedEmails = [];
      email.iysCheck = true;

      if (email.iysCheck) {
        consentedEmails = await checkIYSConsentList(email.appId, emailListToCheck);
        console.log("CONST EMALIS: " + consentedEmails);
        if (!consentedEmails || consentedEmails.length === 0 || (consentedEmails.statusCode && consentedEmails.statusCode !== 200)) {
          throw new Error('Emails are not consented');
        }
      } else {
        // If IYS check is false, assume all emails are consented
        consentedEmails = emailListToCheck;
        console.log("IYS check is bypassed. All emails are considered consented.");
      }

      // Separate consented and non-consented emails
      const nonConsentedEmails = emailListToCheck.filter(email => !consentedEmails.includes(email));

      // Get the FROM email address from SMTP_TABLE using appId
      let fromEmail = '';
      try {
        fromEmail = email.from;
      } catch (error) {
        console.error('Failed to fetch SMTP details:', error);
        throw new Error('Failed to fetch SMTP details');
      }

      // Send emails to consented recipients
      const sendGridMessageId = await sendEmail({
        from: fromEmail,
        subject: email.subject,
        html: html,
        to: consentedEmails
      });

      await updateEmailWithSendGridMessageId(email.emailId, sendGridMessageId);

      console.log("Logging links");
      await logLinks(links, email.emailId);

      // Log delivered emails
      consentedEmails.forEach(mail => {
        emailLogs.push({
          id: uuidv4(),
          emailId: email.emailId,
          sendGridMessageId: sendGridMessageId,
          appId: email.appId,
          createdAt: nowDate,
          updatedAt: nowDate,
          affirmation: 'delivered',
          recipient: mail
        });
      });

      // Log non-consented emails
      nonConsentedEmails.forEach(mail => {
        emailLogs.push({
          id: uuidv4(),
          emailId: email.emailId,
          sendGridMessageId: sendGridMessageId,
          appId: email.appId,
          createdAt: nowDate,
          updatedAt: nowDate,
          affirmation: 'iys failed',
          recipient: mail
        });
      });

      // Save email logs
      if (emailLogs.length > 0) {
        console.log("Saving Email Logs");
        await saveEmailLogs(emailLogs);
      }

      // Update email status
      console.log("Updating Email on table");
      await updateEmail(email.emailId, consentedEmails.length, "delivered");
      await updateEmailSendingLimit(email.appId, consentedEmails.length);
    } catch (error) {
      console.error('Error processing email: ', error);
      throw error;
    }
  }
}





async function getPendingScheduledEmails(now, oneMinLater) {
  const params = {
    TableName: process.env.EMAIL_TABLE,
    FilterExpression: "isScheduled = :isScheduled AND scheduledDate >= :now AND scheduledDate < :oneMinLater",
    ExpressionAttributeValues: {
      ":isScheduled": true,
      ":now": Math.floor(now / 1000),
      ":oneMinLater": Math.floor(oneMinLater / 1000)
    }
  };

  console.log("Scanning with parameters:", JSON.stringify(params, null, 2));

  try {
    const data = await docClient.scan(params).promise();
    console.log("Scan result:", JSON.stringify(data, null, 2));
    return data.Items;
  } catch (error) {
    console.error("Error retrieving scheduled emails:", error);
    throw error;
  }
}

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

async function updateEmail(emailId, totalDelivered, affirmation) {
  const params = {
    TableName: process.env.EMAIL_TABLE,
    Key: { emailId: emailId },
    UpdateExpression: "set isScheduled = :isScheduled, delivered = :totalDelivered, scheduledAffirmation = :affirmation",
    ExpressionAttributeValues: {
      ":isScheduled": false,
      ":totalDelivered": totalDelivered,
      ":affirmation": affirmation
    },
    ReturnValues: "UPDATED_NEW"
  };

  try {
    await docClient.update(params).promise();
    console.log("Email updated successfully.");
  } catch (err) {
    console.error("Error updating email:", err);
    throw err;
  }
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

async function sendEmail(mailOptions) {
  const msg = {
    to: mailOptions.to,
    from: mailOptions.from,
    subject: mailOptions.subject,
    html: mailOptions.html,
  };

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

async function updateEmailWithSendGridMessageId(emailId, sendGridMessageId) {
  const params = {
    TableName: process.env.EMAIL_TABLE,
    Key: { emailId: emailId },
    UpdateExpression: "set sendGridMessageId = :sendGridMessageId",
    ExpressionAttributeValues: {
      ":sendGridMessageId": sendGridMessageId
    },
    ReturnValues: "UPDATED_NEW"
  };

  try {
    await docClient.update(params).promise();
    console.log("Email updated with sendGridMessageId successfully.");
  } catch (err) {
    console.error("Error updating email with sendGridMessageId:", err);
    throw err;
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


async function updateEmailSendingLimit(appId, emailCount) {
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

  // Her bir parça için kaydetme işlemini gerçekleştir
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
