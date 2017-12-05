const _ = require('lodash');
const App = require('./App');

const app = new App();

app.queries = {
	onMessage: {
		inbound: (clientId, queryObj, payload) => {
			return [
				'inbound/messages'
			];
		},
		outbound: (clientId, queryObj, payload) => {
			return [
				clientId
			];
		}
	}
};

exports.handler = (event, context, callback) => {
	const {
		payload,
		topic
	} = event;
	
	console.log(JSON.stringify(event, null, 2));

	let operation;

	if (_.startsWith(topic, 'inbound')) {
		operation = app.onInbound(topic, payload);
	} else if (_.startsWith(topic, 'subscribe')) {
		operation = app.onSubscribe(topic, payload);
	} else if (_.startsWith(topic, '$aws/events/presence/disconnected')) {
		operation = app.onDisconnect(topic, payload);
	}

	if (!operation) {
		callback(null, null);
	}

	operation.subscribe(
		response => {
			console.log(JSON.stringify(response, null, 2));
			callback(null, response);
		},
		err => {
			console.log(err);
			callback(err);
		}
	);
};
