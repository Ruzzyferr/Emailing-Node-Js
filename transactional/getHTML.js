const AWS = require('aws-sdk');
const S3 = new AWS.S3();
const { responseStatus } = require('../../utils/response');


exports.getHTML = async (event, context) => {
  const appId = event.queryStringParameters?.appId;
  if (!appId) {
    return responseStatus(400, {message: "Missing app id!"});
  }
  const scenarioId = event.pathParameters?.id;
  if (!scenarioId) {
    return responseStatus(400, {message: "Missing scenario id!"});
  }
  
  try {
    const htmlText = await getHTMLTempFromS3(appId, scenarioId);
    return responseStatus(200, {htmlText});
  } catch (err) {
    console.log("Error: ", err);
    return responseStatus(500, {message: err});
  }
}

const getHTMLTempFromS3 = async (appId, scenarioId) => {
  const params = {
    Bucket: process.env.EMAIL_TEMPLATES_BUCKET_NAME,
    Key: `${appId}/${scenarioId}.html`
  }
  const result = await S3.getObject(params).promise();
  console.log("result: ",result)
  console.log("buffer read: ", result.Body.toString());
  return result.Body.toString();
}