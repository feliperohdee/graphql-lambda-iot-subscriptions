const AWS = require('aws-sdk');

const production = process.env.NODE_ENV === 'production';

AWS.config.update({
	accessKeyId: process.env.ACCESS_KEY_ID,
	secretAccessKey: process.env.SECRET_ACCESS_KEY,
	region: process.env.REGION || 'us-east-1'
});

module.exports = {
	iot: new AWS.IotData({
		endpoint: process.env.IOT_ENDPOINT || 'a2p3sz3zxqdecq.iot.us-east-1.amazonaws.com'
	}),
	dynamoDb: new AWS.DynamoDB({
		endpoint: production ? null : 'http://localhost:9090'
	})
};
