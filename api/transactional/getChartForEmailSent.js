const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const { responseStatus } = require("../../utils/response");

exports.getChartForEmailSent = async (event, context) => {
  try {

    const { scenarioId, startDate, endDate } = event?.queryStringParameters || {};
    
    if (!scenarioId || !startDate || !endDate) {
      return responseStatus(400, {
        message: "empty queryStrings",
      });
    } 

    const returnData = await getEmailLogs(scenarioId, startDate, endDate);
    const chartData = await createChartData(returnData, startDate, endDate);
    return responseStatus(200, chartData);

  } catch (err) {
    console.log("Error:", err);
    return responseStatus(500, {
      message: err,
    });
  }
};

const getEmailLogs = async (scenarioId, startDate, endDate) => {
  const params = {
    TableName: process.env.EMAIL_LOGS_TABLE,
    IndexName: "scenarioId-createdAt-index",
    KeyConditionExpression:
      "#scenarioId = :value AND #createdAt BETWEEN :startDate AND :endDate",
    ExpressionAttributeValues: {
      ":value": scenarioId,
      ":startDate": Number(startDate),
      ":endDate": Number(endDate),
    },
    ExpressionAttributeNames: { "#scenarioId": "scenarioId", "#createdAt": "createdAt" },
    ScanIndexForward: false,
  };
  const data = await docClient.query(params).promise();
  console.log("get data in getEmailLogs: ", data.Items);
  return data.Items;
};

const createChartData = async (data, startDate, endDate) => {
  let oneDay = 60 * 60 * 24;
  let date = 0;
  let dateArrs = [];
  for (let i = 0; Number(endDate) >= date; i++) {
    date = Number(startDate) + oneDay * i;
    // let timestampToDate = new Date(date * 1000);
    // const setHoursToDate = new Date(timestampToDate.setHours(0, 0, 0, 0));
    // const againTimestamp = Math.floor(
    //   new Date(setHoursToDate).getTime() / 1000
    // );
    dateArrs.push(date);
  }
  const lastArr = [];
  await Promise.all(
    dateArrs.map(async (date) => {
      let sent = 0;
      await Promise.all(
        data.map((res) => {
          if (
            new Date(date * 1000).getDate() ==
              new Date(res.createdAt * 1000).getDate() &&
            new Date(date * 1000).getMonth() ==
              new Date(res.createdAt * 1000).getMonth()
          ) {
            sent = sent + 1;
          }
        })
      );
      const timestampToDate = new Date(date * 1000);
      lastArr.push({
        date: timestampToDate,
        sent,
      });
    })
  );
  console.log("lastArr", lastArr);
  return lastArr;
};
