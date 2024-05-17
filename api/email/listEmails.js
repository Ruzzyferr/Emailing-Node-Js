const AWS = require("aws-sdk");
const {responseStatus} = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.listEmails = async (event, context, callback) => {
  try {
    const appId = event.queryStringParameters?.appId;
    if (!appId) {
      console.log("empty appId")
    }
    console.log("appId:", appId);

    return await getEmailsByAppId(appId);
  } catch (err) {
    console.log("Error:", err);
    throw err;
    }
};

const getEmailsByAppId = async (appId) => {
  const params = {
    TableName: process.env.EMAIL_TABLE,
    IndexName: "appId-index",
    KeyConditionExpression: "#appId = :value",
    ExpressionAttributeValues: { ":value": appId},
    ExpressionAttributeNames: { "#appId": "appId"},
    ScanIndexForward: false
  };

  console.log('Query Parameters:', params);
  let result =  await docClient.query(params).promise();
  return responseStatus(200,result.Items);
};
