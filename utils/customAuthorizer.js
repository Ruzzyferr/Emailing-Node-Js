'use strict';
module.exports.customAuthorizer = async (event, context) => {
  console.log('event: ', event);
  return generatePolicy("user", "Allow", event.methodArn);
}

// const jwtVerify = (tkn, pem) => {
//   return new Promise((resolve, reject) => {
//     jwt.verify(tkn, pem, function (err, decoded) {
//       if (decoded) resolve(decoded);
//       if (err) reject(err);
//     });
//   });
// };

// Help function to generate an IAM policy
var generatePolicy = function (principalId, effect, resource, context) {
  var authResponse = {};

  authResponse.principalId = principalId;
  if (effect && resource) {
    var policyDocument = {};
    policyDocument.Version = '2012-10-17';
    policyDocument.Statement = [];
    var statementOne = {};
    statementOne.Action = 'execute-api:Invoke';
    statementOne.Effect = effect;
    statementOne.Resource = resource;
    policyDocument.Statement[0] = statementOne;
    authResponse.policyDocument = policyDocument;
  }

  // Optional output with custom properties of the String, Number or Boolean type.
  authResponse.context = {
    // stringKey: 'stringval', // it is error message
    numberKey: 123,
    booleanKey: true,
    ...context
  };
  console.log("authResponse: ",JSON.stringify(authResponse));
  return authResponse;
};