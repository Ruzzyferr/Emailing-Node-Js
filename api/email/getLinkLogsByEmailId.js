const AWS = require("aws-sdk");
const { responseStatus } = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.getLinkLogsByEmailId = async (event, context, callback) => {
  const emailId = event.queryStringParameters?.emailId;
  if (!emailId) {
    console.error("EmailId empty");
    return responseStatus(400, { message: "EmailId is required" });
  }

  try {
    const emailData = await getLogsByEmailId(emailId);
    console.log("Retrieved email data:", emailData);
    return responseStatus(200, emailData);
  } catch (err) {
    console.log("Error retrieving email:", err);
    return responseStatus(500, err);
  }
};

const getLogsByEmailId = async (emailId) => {
  console.log("emailId", emailId);
  const params = {
    TableName: process.env.LINK_INFO_LOG_TABLE,
    FilterExpression: "emailId = :emailId",
    ExpressionAttributeValues: {
      ":emailId": emailId,
    },
  };

  try {
    const data = await docClient.scan(params).promise();
    console.log("Data fetched in get:", data);
    return data.Items ? data.Items : [];  // Scan işlemiyle birden fazla item dönebilir
  } catch (err) {
    console.error("Failed to fetch data from DynamoDB:", err);
    throw err;  // Rethrow the error to be handled by the caller
  }
};
