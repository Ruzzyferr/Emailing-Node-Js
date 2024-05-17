const AWS = require("aws-sdk");
const SES = new AWS.SES({ region: "eu-north-1" });
const S3 = new AWS.S3();
const docClient = new AWS.DynamoDB.DocumentClient();
const ejs = require("ejs");
const MailComposer = require("nodemailer/lib/mail-composer");
const { responseStatus } = require("../../utils/response");
const { v4: uuidv4 } = require("uuid");

exports.sendTransEmail = async (event, context) => {
  const data = event.body && JSON.parse(event.body);
  console.log("works");
  if (!data) {
    return responseStatus(400, {
      message: "Your body request is missing!",
    });
  }

  const { appId } = event.queryStringParameters || {};
  if (!appId) {
    return responseStatus(400, { message: "Missing app id!" });
  }

  const { scenarioId, templateData } = data;

  if (!scenarioId || !templateData) {
    return responseStatus(400, {
      message:
        "You should check body request because there is missing required attributes",
    });
  }

  let scenario;
  try {
    scenario = await getScenarioByID(appId, scenarioId);
    if (!scenario) {
      return responseStatus(404, {
        message: "The scenario does not exist!",
      });
    }
    if (!scenario?.isEmailActive) {
      return responseStatus(401, {
        message: "This scenario deactivated for send email.",
      });
    }
  } catch (err) {
    console.log("Error: ", err);
    return responseStatus(500, { message: err });
  }

  const emailContentType = scenario?.emailContentType;
  // if (!emailContentType) {
  //   return responseStatus(400, {
  //     message: 'This scenario has no email content type!',
  //   });
  // }

  let html;

  if (emailContentType === "HTML" || !emailContentType) {
    let htmlTemp;
    try {
      htmlTemp = await getHTMLTempFromS3(appId, scenarioId);
    } catch (err) {
      console.log("error:", err);
      if (err?.code === "NoSuchKey") {
        return responseStatus(404, {
          message: "The template does not exist!",
        });
      }
      return responseStatus(500, {
        message: "The template does not exist or something went wrong!",
      });
    }

    try {
      html = await ejs.render(htmlTemp, templateData, { async: true });
    } catch (err) {
      return responseStatus(500, {
        message:
          "Something is wrong with template, check your template and/or template data!",
        error: err,
      });
    }
  }

  // console.log('html: ', html);

  const destination = scenario?.destination;
  if (!destination?.length) {
    return responseStatus(400, {
      message: "This scenario has no destination!",
    });
  }

  const subject = scenario?.subject;
  if (!subject) {
    return responseStatus(400, {
      message: "This scenario has no subject!",
    });
  }

  // const mailOptions4raw = {
  //   from: '"Info hellosmpl" <no-reply@hellosmpl.com>',
  //   sender: 'no-reply@hellosmpl.com',
  //   to: 'no-reply@hellosmpl.com',
  //   subject: subject,
  //   text: 'İf you are seeing this mail please contact to us',
  //   html: html,
  // };

  let source =
    (scenario && scenario.scenarioName === "Kosova Form Test") ||
    (scenario && scenario.scenarioName === "Kosova Form")
      ? '"İşbank Kosova Bilgilendirme" <no-reply@hellosmpl.com>'
      : '"Hellosmpl" <no-reply@hellosmpl.com>';

  const mailOptions4Formatted = {
    source: source,
    destination: destination,
    subject: subject,
    text: "Contact to smpl.",
  };

  if (html) {
    mailOptions4Formatted.html = html;
  }

  if (emailContentType === "TEXT") {
    const jsonTemplateData = JSON.stringify(templateData);
    var parts = jsonTemplateData.split(" | ").join("|");
    var output = parts.replace(/"/g, "");
    mailOptions4Formatted.text = output.trim();
  }

  try {
    // const rawMessage = await createRawMessage(mailOptions4raw);
    // console.log('raw msg: ', rawMessage.toString());

    // const emailSent = await sendRawEmail(rawMessage);
    console.log("mailData: ", JSON.stringify(mailOptions4Formatted));
    const emailSent = await sendEmail(mailOptions4Formatted);
    console.log("emailSent: ", emailSent);
    if (!emailSent) {
      throw new Error("Something went wrong!");
    }
    await logEmailToDB({
      scenarioId,
      logId: uuidv4(),
      appId,
      subject,
      destination,
      emailResponse: emailSent,
    });
    await logTotalSentEmail(scenario);
    return responseStatus(200, { message: "Success!" });
  } catch (err) {
    return responseStatus(500, { error: err });
  }
};

const sendEmail = async ({ source, destination = [], subject, text, html }) => {
  var params = {
    Source: source,
    Destination: {
      ToAddresses: destination,
    },
    Message: {
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
      Body: {
        Text: {
          Charset: "UTF-8",
          Data: text,
        },
      },
    },
  };
  if (html) {
    params.Message.Body.Html = {
      Charset: "UTF-8",
      Data: html,
    };
  }
  const emailSent = await SES.sendEmail(params).promise();
  return emailSent;
};

const sendRawEmail = async (rawEmailData) => {
  const params = {
    RawMessage: {
      Data: rawEmailData,
    },
  };
  return SES.sendRawEmail(params).promise();
};

// https://nodemailer.com/extras/mailcomposer/
const createRawMessage = (mailOptions) => {
  return new Promise((resolve, reject) => {
    let mail = new MailComposer(mailOptions);
    mail.compile().build(function (err, message) {
      if (err) reject(err);
      if (message) resolve(message);
    });
  });
};

const getHTMLTempFromS3 = async (appId, scenarioId) => {
  const params = {
    Bucket: process.env.EMAIL_TEMPLATES_BUCKET_NAME,
    Key: `${appId}/${scenarioId}.html`,
  };
  const result = await S3.getObject(params).promise();
  console.log("result: ", result);
  console.log("buffer read: ", result.Body.toString());
  return result.Body.toString();
};

const getScenarioByID = async (appId, scenarioId) => {
  const params = {
    TableName: process.env.SCENARIO_TABLE,
    KeyConditionExpression:
      "#scenarioId = :scenarioValue and #appId = :appValue",
    FilterExpression: "#type = :typeVal",
    ExpressionAttributeValues: {
      ":scenarioValue": scenarioId,
      ":appValue": appId,
      ":typeVal": "transactional",
    },
    ExpressionAttributeNames: {
      "#scenarioId": "scenarioId",
      "#appId": "appId",
      "#type": "type",
    },
  };
  const data = await docClient.query(params).promise();
  console.log("get data in getScenarioByID", data);
  return data.Items.length ? data.Items[0] : null;
};

const logEmailToDB = async (data) => {
  const nowDate = Math.floor(new Date(`${new Date()}`).getTime() / 1000);
  const params = {
    TableName: process.env.EMAIL_LOGS_TABLE,
    Item: {
      ...data,
      createdAt: nowDate,
    },
  };
  await docClient.put(params).promise();
};

const logTotalSentEmail = async (scenario) => {
  let totalEmailSent = 1;
  if (scenario?.totalEmailSent) {
    totalEmailSent += scenario?.totalEmailSent;
  }

  const nowDate = Math.floor(new Date(`${new Date()}`).getTime() / 1000);
  const params = {
    TableName: process.env.SCENARIO_TABLE,
    Key: {
      appId: scenario.appId,
      scenarioId: scenario.scenarioId,
    },
    ExpressionAttributeNames: {
      "#totalEmailSent": "totalEmailSent",
      "#updatedAt": "updatedAt",
    },
    ExpressionAttributeValues: {
      ":totalEmailSent": totalEmailSent,
      ":updatedAt": nowDate,
    },
    UpdateExpression:
      "SET #totalEmailSent = :totalEmailSent, #updatedAt = :updatedAt",
  };
  await docClient.update(params).promise();
};
