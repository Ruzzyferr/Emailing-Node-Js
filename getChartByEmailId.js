const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const { responseStatus } = require("../utils/response");

exports.getChartByEmailId = async (event, context, callback) => {
  console.log(
      "event.requestContext.authorizer",
      JSON.stringify(event.requestContext.authorizer)
  );

  try {
    let appId;
    let emailId;
    let days;

    if (
        event.queryStringParameters &&
        event.queryStringParameters.appId &&
        event.queryStringParameters.emailId &&
        event.queryStringParameters.days
    ) {
      emailId = event.queryStringParameters.emailId;
      appId = event.queryStringParameters.appId;
      days = parseInt(event.queryStringParameters.days, 10);
      console.log("emailId, appId, days:", emailId, appId, days);
    } else {
      return responseStatus(400, {
        email: "empty queryStrings",
      });
    }

    const emailData = await getEmailById(appId, emailId);
    const chartData = await createChartData(emailData, days);
    return responseStatus(200, {
      chartData: chartData,
    });
  } catch (err) {
    console.log("Error:", err);
    return responseStatus(500, {
      email: err,
    });
  }
};

const getEmailById = async (appId, emailId) => {
  const params = {
    TableName: process.env.EMAILS_LOGS_TABLE,
    FilterExpression: "#appId = :appValue AND #emailId = :emailValue",
    ExpressionAttributeValues: {
      ":appValue": appId,
      ":emailValue": emailId,
    },
    ExpressionAttributeNames: { "#appId": "appId", "#emailId": "emailId" },
  };
  const data = await docClient.scan(params).promise();
  console.log("get data in getEmailById", data);
  return data.Items;
};

const createChartData = async (emailList, days) => {
  const oneDay = 60 * 60 * 24;
  const nowDate = Math.floor(new Date().getTime() / 1000);
  const startDate = nowDate - oneDay * (days-1);

  // Veri toplama döngüsü
  let date = startDate;
  let dateArrs = [];
  while (date <= nowDate) {
    dateArrs.push(date);
    date += oneDay;
  }

  // Sonuçları işleme
  const lastArr = dateArrs.map((date) => {
    let opened = 0;
    let delivered = 0;
    let iysBlocked = 0;
    let totalSent = emailList.filter(emailData => emailData.createdAt <= date).length;

    // Her email öğesini kontrol et
    emailList.forEach(emailData => {
      const updatedAt = emailData.updatedAt || emailData.createdAt; // Güncellenmiş tarih yoksa oluşturulma tarihini kullan

      if (updatedAt <= date && emailData.affirmation === "opened") {
        opened += 1;
        delivered +=1;
      }
      if (updatedAt <= date && emailData.affirmation === "delivered") {
        delivered += 1;
      }
      if (updatedAt <= date && emailData.affirmation === "iys failed") {
        iysBlocked += 1;
      }
    });

    // Tarihi ISO formatına dönüştür
    const timestampToDate = new Date(date * 1000);
    const isoDate = timestampToDate.toISOString();

    return {
      date: isoDate,
      opened: opened,
      totalSent: totalSent,
      iysBlocked: iysBlocked,
      delivered: delivered,
    };
  });

  return lastArr;
};
