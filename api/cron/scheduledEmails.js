const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

exports.handler = async (event) => {
  try {
    await scheduleEmailSending();
    return { statusCode: 200, body: 'Emails scheduled successfully.' };
  } catch (error) {
    console.error('Error scheduling emails:', error);
    return { statusCode: 500, body: 'Error scheduling emails.' };
  }
};

const scheduleEmailSending = async () => {
  const now = Date.now(); // Current time in milliseconds
  const oneMinLater = new Date(now + (60 * 1000)); //1 min later

  console.log("now",now);

  const emails = await getPendingScheduledEmails(now, oneMinLater);
  for (const email of emails) {
    const failedEmails = [];
     const topicEmails = await getEmailsByTopic(email.topicName, email.appId);
     console.log(topicEmails);
    for (const recipient of topicEmails) {
      const emailData = {
        to: recipient,
        subject: email.subject,
        body: email.body
      };
      try {
        await sendEmail(emailData, email.emailId); // E-postayı gönder
      } catch (error) {
        console.error(`Error sending email to ${recipient}:`, error);
        failedEmails.push({emailId: email.emailId, recipient: recipient}); // Başarısız e-postayı listeye ekle
      }
    }
    await updateEmail(email.emailId); // E-posta gönderildikten sonra güncelle
    for (const failedEmail of failedEmails) {
      try {
        await saveFailedEmail(failedEmail.emailId, failedEmail.recipient);
      } catch (error) {
        console.error("Error saving failed email:", error);
      }
    }
  }

};

const getPendingScheduledEmails = async (timestamp, oneMinLater) => {
  const params = {
    TableName: process.env.EMAIL_TABLE,
    IndexName: 'appId-index',
    FilterExpression: "isScheduled = :isScheduled AND scheduledDate >= :now AND scheduledDate < :oneMinLater",
    ExpressionAttributeValues: {
      ":isScheduled": true,
      ":oneMinLater": Math.floor(oneMinLater / 1000), // Convert to seconds
      ":now": Math.floor(timestamp / 1000) // Convert to seconds
    }
  };

  try {
    const data = await docClient.scan(params).promise();
    console.log("Data retrieved from getPendingScheduledEmails:\n", data);
    console.log("PARAMS:\n", params);
    return data.Items;
  } catch (error) {
    console.error("Error retrieving scheduled emails:", error);
    throw error;
  }
};

const getEmailsByTopic = async (topicName, appId) => {
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

const updateEmail = async (emailId) => {
  const params = {
    TableName: process.env.EMAIL_TABLE,
    Key: {
      emailId: emailId
    },
    UpdateExpression: "set isScheduled = :isScheduled",
    ExpressionAttributeValues: { ":isScheduled": false },
    ReturnValues: "UPDATED_NEW"
  };

  try {
    await docClient.update(params).promise();
    console.log("Email updated successfully.");
  } catch (err) {
    console.error("Error updating email:", err);
    throw err;
  }
};

const sendEmail = async (emailData) => {
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: emailData.to,
    subject: emailData.subject,
    text: emailData.body
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully.");
  } catch (err) {
    console.error("Error sending email:", err);
    throw err;
  }
};
const saveFailedEmail = async (emailId, recipient) => {
  const params = {
    TableName: process.env.FAILED_EMAIL_TABLE,
    Item: {
      emailId: emailId,
      recipient: recipient,
      status: 'EMAIL_FAIL',
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
