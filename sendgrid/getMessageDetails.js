const client = require('@sendgrid/client');
const {responseStatus} = require("../../utils/response");

exports.handler = async (event) => {
    const apiKey = process.env.SENDGRID_API_KEY;
    const sendGridClient = new SendGridClient(apiKey);

    // API Gateway'den gelen path ve messageId parametrelerini al
    const messageId = event.pathParameters.messageId;

    try {
        const result = await sendGridClient.getMessage(messageId);
        return responseStatus(result.statusCode,result.body)
    } catch (error) {
        return responseStatus(500,error.message)
    }
};

class SendGridClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        client.setApiKey(this.apiKey);
    }

    async getMessage(messageId) {
        const request = {
            url: `https://api.sendgrid.com/v3/messages/` + messageId,
            method: 'GET',
        };

        try {
            const [response, body] = await client.request(request);
            return responseStatus(response.statusCode,response.body)
        } catch (error) {
            throw new Error(error.response ? error.response.body : error.message);
        }
    }
}

