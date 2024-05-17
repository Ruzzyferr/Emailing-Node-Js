exports.responseStatus = async (statusCode, body) => {
  return {
    statusCode: statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify(body),
  };
};