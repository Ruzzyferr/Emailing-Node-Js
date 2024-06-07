const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const axios = require('axios');
const cheerio = require("cheerio");

// const smtpConfig = {
//   host: process.env.SMTP_HOST,
//   port: process.env.SMTP_PORT,
//   secure: false,
//   auth: {
//     user: process.env.SMTP_USER,
//     pass: process.env.SMTP_PASS
//   }
// };

exports.handler = async (event) => {
  try {
    await scheduleEmailSending();
    return { statusCode: 200, body: 'Emails scheduled successfully.' };
  } catch (error) {
    console.error('Error scheduling emails:', error);
    return { statusCode: 500, body: 'Error scheduling emails.' };
  }
};

const CHUNK_SIZE = 100;

async function scheduleEmailSending () {
  const now = Date.now();
  const oneMinLater = new Date(now + (60 * 1000));

  const emails = await getPendingScheduledEmails(now, oneMinLater);

  for (const email of emails) {
    try {
      console.log("GONDERILECEK EMAILLER:  +++  " + email);
      let topicEmails = [];

      if (email.emailList != null) {
        topicEmails = email.emailList;
      } else {
        topicEmails = await getEmailsByTopic(email.topicName, email.appId);
      }

      const smtpConfig = await getSmtpConfig(email.appId);
      if (smtpConfig.statusCode === 404){
        await updateEmail(email.emailId, 0, "SMTP Information not found");
        return { statusCode: 404, body: `SMTP configuration not found for appId: ${email.appId}` };
      }

      const { html, links } = extractLinks(email.html);


      const nowDate = Math.floor(new Date().getTime() / 1000);
      const emailLogs = [];

      const consentedEmailss = [];
      const iysFailed = [];

      try {
        console.log("Checking IYS consent status")
        const consentedEmails = await checkIYSConsentList(topicEmails);

        topicEmails.forEach(mail => {
          if (consentedEmails.includes(mail)) {
            consentedEmailss.push(mail);
          } else {
            iysFailed.push(mail);
          }
        });

      } catch (error) {
        console.error('Error checking IYS consent:', error);
        throw error;
      }

      const totalEmails = consentedEmailss.length;
      let totalSent = 0;
      let startIndex = 0;

      while (startIndex < totalEmails) {
        const endIndex = Math.min(startIndex + CHUNK_SIZE, totalEmails);
        const chunk = consentedEmailss.slice(startIndex, endIndex);

        if (chunk.length > 0) {
          console.log("Sending Emails");
          await sendEmail({ to: '', bcc: chunk, subject: email.subject, body: email.body, html: email.html }, smtpConfig);
          totalSent += chunk.length;
        }

        startIndex += CHUNK_SIZE;
      }

      console.log("Logging links");
      await logLinks(links, email.emailId);

      consentedEmailss.forEach(mail => {
        emailLogs.push({
          id: uuidv4(),
          emailId: email.emailId,
          appId: email.appId,
          createdAt: nowDate,
          updatedAt: nowDate,
          affirmation: 'delivered',
          recipient: mail
        });
      });

      iysFailed.forEach(mail => {
        emailLogs.push({
          id: uuidv4(),
          emailId: email.emailId,
          appId: email.appId,
          createdAt: nowDate,
          updatedAt: nowDate,
          affirmation: 'iys failed',
          recipient: mail
        });
      });

      console.log("failed" + iysFailed);

      if (emailLogs.length > 0) {
        console.log("Saving Email Logs");
        await saveEmailLogs(emailLogs);
      }
      console.log("Updating Email on table");
      await updateEmail(email.emailId, totalSent, "delivered");
    } catch (error) {
      console.error('Error sending emails: ', error);
      throw error;
    }
  }
}

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

async function getPendingScheduledEmails(timestamp, oneMinLater) {
  const params = {
    TableName: process.env.EMAIL_TABLE,
    FilterExpression: "isScheduled = :isScheduled AND scheduledDate >= :now AND scheduledDate < :oneMinLater",
    ExpressionAttributeValues: {
      ":isScheduled": true,
      ":oneMinLater": Math.floor(oneMinLater / 1000),
      ":now": Math.floor(timestamp / 1000)
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


async function getEmailsByTopic(topicName, appId) {
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
    }
  };

  try {
    const data = await docClient.scan(params).promise();
    const mails = data.Items.map(item => item.emails);
    return mails.flat();
  } catch (error) {
    console.error("Error retrieving topic mails:", error);
    throw error;
  }
};

async function updateEmail (emailId, totalDelivered, affirmation)  {
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
