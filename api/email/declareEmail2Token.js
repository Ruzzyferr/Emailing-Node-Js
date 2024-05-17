const AWS = require('aws-sdk');
const { responseStatus } = require("../../utils/response");

const dynamoDB = new AWS.DynamoDB.DocumentClient();

// E-posta adresini güncelle
const updateEmail = async (existingItem, email) => {
    let emails = existingItem.emails || [];
    if (!emails.includes(email)) {
        emails.push(email);
    }
    return emails;
};

exports.declareEmail2Token = async (event) => {
    try {
        const { token, email } = JSON.parse(event.body);

        const params = {
            TableName: 'tokensTable-smpl-notification-dev',
            KeyConditionExpression: '#tk = :t',
            ExpressionAttributeNames: {
                '#tk': 'token'
            },
            ExpressionAttributeValues: {
                ':t': token
            }
        };

        const data = await dynamoDB.query(params).promise();

        if (data.Items && data.Items.length > 0) {
            const existingItem = data.Items[0];

            const updatedEmails = await updateEmail(existingItem, email);


            const updatedItem = {
                ...existingItem,
                emails: updatedEmails
            };

            const updateParams = {
                TableName: process.env.TOKENS_TABLE,
                Key: {
                    'token': existingItem.token,
                    'topicName': existingItem.topicName
                },
                UpdateExpression: 'SET emails = :e',
                ExpressionAttributeValues: {
                    ':e': updatedItem.emails
                }
            };

            await dynamoDB.update(updateParams).promise();
            return await responseStatus(200, updatedItem);
        } else {

            return await responseStatus(404, { message: 'Token bulunamadı' });
        }
    } catch (err) {
        console.error('Hata:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Bir hata oluştu' })
        };
    }
};
