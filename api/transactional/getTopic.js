const AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();
const { responseStatus } = require("../utils/response");

exports.getTopic = async (event, context, callback) => {
  // console.log("event", event);
  // const cognitoIdentity = JSON.stringify(
  //   event.requestContext.authorizer.claims
  // );
  // console.log("cognitoIdentity", cognitoIdentity);
  try {
    var appId;
    var topicName;
    if (event.queryStringParameters && event.queryStringParameters.appId) {
      appId = event.queryStringParameters.appId;
      console.log("appId:" + appId);
    } else {
      return responseStatus(400, {
        message: "empty appId",
      });
    }
    if (event.pathParameters && event.pathParameters.id) {
        topicName = event.pathParameters.id;
        console.log("topicName:" + topicName);
      } else {
        return responseStatus(400, {
          message: "empty topicName",
        });
      }
    // if (
    //   event.requestContext.authorizer.claims &&
    //   event.requestContext.authorizer.claims["cognito:groups"] &&
    //   (event.requestContext.authorizer.claims["cognito:groups"]
    //     .split(",")
    //     .includes(appId) ||
    //     event.requestContext.authorizer.claims["cognito:groups"]
    //       .split(",")
    //       .includes("super_admin"))
    // ) {
      const returnData = await getTopicById(appId, topicName);
      console.log("returnData", returnData);
      return responseStatus(200, returnData);
    // } else {
    //   return responseStatus(401, {
    //     message: "Unauthorized",
    //   });
    // }
  } catch (err) {
    console.log("Error:", err);
    return responseStatus(500, {
      message: err,
    });
  }
};

const getTopicById = async (appId, topicName) => {
  const params = {
    TableName: process.env.TOPICS_TABLE,
    KeyConditionExpression: "#topicName = :topicValue and #appId = :appValue",
    ExpressionAttributeValues: { ":topicValue": topicName, ":appValue": appId},
    ExpressionAttributeNames: { "#topicName": "topicName", "#appId": "appId" },
  };
  const data = await docClient.query(params).promise();
  console.log("get data in getTopicById", data);
  return data.Items;
};



const getTopicUsersFromDatabase = async (appId) => {
  const params = {
    TableName: process.env.TOPICS_USERS_TABLE,
    KeyConditionExpression: "#appId = :appId",
    ExpressionAttributeValues: {
      ":appId": appId,
    },
    ExpressionAttributeNames: {
      "#appId": "appId",
    },
  };

  const data = await docClient.query(params).promise();
  return data.Items;
};