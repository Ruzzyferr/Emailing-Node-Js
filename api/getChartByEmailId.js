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
    if (
        event.queryStringParameters &&
        event.queryStringParameters.appId &&
        event.queryStringParameters.emailId
    ) {
      emailId = event.queryStringParameters.emailId;
      appId = event.queryStringParameters.appId;
      console.log("emailId, appId:", emailId, appId);
    } else {
      return responseStatus(400, {
        email: "empty queryStrings",
      });
    }

    const emailData = await getEmailById(appId, emailId);
    const chartData = await createChartData(emailData);
    return responseStatus(200, {
      chartData: chartData
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
    TableName: process.env.EMAIL_LOGS_TABLE,
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

const createChartData = async (emailList) => {
  const oneDay = 60 * 60 * 24;
  const nowDate = Math.floor(new Date().getTime() / 1000);
  const thirtyDaysAgo = nowDate - oneDay * 30;

  // Veri toplama döngüsü
  let date = thirtyDaysAgo;
  let dateArrs = [];
  while (date <= nowDate) {
    dateArrs.push(date);
    date += oneDay;
  }

  // Sonuçları işleme
  const lastArr = dateArrs.map((date) => {
    let opened = 0;
    let received = emailList.filter(emailData => emailData.createdAt <= date).length;

    // Her email öğesini kontrol et
    emailList.forEach(emailData => {
      const updatedAt = emailData.updatedAt || emailData.createdAt; // Güncellenmiş tarih yoksa oluşturulma tarihini kullan


      if (updatedAt <= date && emailData.affirmation === "opened" ) {
        opened += 1;
      }
    });

    // Tarihi yerel zamana dönüştür
    const timestampToDate = new Date(date * 1000);
    const localDate = timestampToDate.toLocaleDateString();

    return {
      date: localDate,
      opened: opened,
      received: received,
    };
  });

  return lastArr;
};





