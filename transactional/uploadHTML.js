const AWS = require('aws-sdk');
const S3 = new AWS.S3();
const { responseStatus } = require('../../utils/response');


exports.uploadHTML = async (event, context) => {
  const data = event.body && JSON.parse(event.body);
  // const data = event.body;

  if (!data) {
    return responseStatus(400, {
      message: 'Your body request is missing!'
    })
  }
  console.log(data);

  const appId = event.queryStringParameters?.appId;
  if (!appId) {
    return responseStatus(400, {message: "Missing app id!"});
  }

  const { scenarioId, htmlText } = data;

  if (!scenarioId || !htmlText) {
    return responseStatus(400, {
      message: 'Missing scenario id and/or htmlText!',
    });
  }
  
  try {
    await uploadHTMLtoS3({appId, scenarioId, htmlText});
  } catch (err) {
    console.log("Error: ", err);
    return responseStatus(500, {message: err});
  }
  
  return responseStatus(200, {message: "Success!"});
}

const uploadHTMLtoS3 = async ({appId, scenarioId, htmlText}) => {
  const params = {
    Bucket: process.env.EMAIL_TEMPLATES_BUCKET_NAME,
    Key: `${appId}/${scenarioId}.html`,
    Body: htmlText,
    ContentType: "text/html",
  };
  const result = await S3.putObject(params).promise(); // return eTag
}