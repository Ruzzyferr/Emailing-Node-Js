const AWS = require("aws-sdk");
const {responseStatus} = require("../../utils/response");
const docClient = new AWS.DynamoDB.DocumentClient();

exports.getEmail = async (event, context, callback) => {

  const emailId = event.queryStringParameters?.emailId;
  if (!emailId) {
    console.error("EmailId empty")
  }
  try {
    const emailData = await getEmailById(emailId);
    console.log("Retrieved email data:", emailData);
    return  responseStatus(200,emailData);
  } catch (err) {
    console.log("Error retrieving email:", err);
    return responseStatus(500,err);
  }
};

const getEmailById = async (emailId) => {
  console.log("emailId",emailId);
  const params = {
    TableName: process.env.EMAIL_TABLE,
    Key: {
      emailId: emailId,
    }
  };

  try {
    const data = await docClient.get(params).promise();
    console.log("Data fetched in getEmailById:", data);
    return data.Item ? data.Item : null;  // Return the item if it exists, otherwise return null
  } catch (err) {
    console.error("Failed to fetch data from DynamoDB:", err);
    throw err;  // Rethrow the error to be handled by the caller
  }

};
