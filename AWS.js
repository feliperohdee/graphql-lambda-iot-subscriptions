const AWS = require('aws-sdk');

AWS.config.update({
	accessKeyId: process.env.ACCESS_KEY_ID,
	secretAccessKey: process.env.SECRET_ACCESS_KEY,
	region: process.env.REGION || 'us-east-1'
});

module.exports = {
	iot: new AWS.IotData({
		endpoint: process.env.IOT_ENDPOINT
	}),
	dynamoDb: new AWS.DynamoDB({
		endpoint: process.env.DYNAMODB_ENDPOINT
	})
};
