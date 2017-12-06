const _ = require('lodash');
const beautyError = require('smallorange-beauty-error');
const {
	GraphQLSchema,
	GraphQLObjectType,
	GraphQLString
} = require('graphql');

const Subscriptions = require('./Subscriptions');

const Message = new GraphQLObjectType({
	name: 'Message',
	fields: {
		text: {
			type: GraphQLString
		}
	}
});

const schema = new GraphQLSchema({
	query: new GraphQLObjectType({
		name: 'Query',
		fields: {
			message: {
				type: Message
			}
		}
	}),
	subscription: new GraphQLObjectType({
		name: 'Subscription',
		fields: {
			onMessage: {
				type: Message,
				// args: {},
				resolve: root => root
			}
		}
	})
});

const events = {
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

const subscriptions = new Subscriptions(events, schema);

exports.handler = (event, context, callback) => {
	const {
		payload,
		topic
	} = event;
	
	// console.log(JSON.stringify(event, null, 2));

	let operation;

	if (_.startsWith(topic, 'inbound')) {
		operation = subscriptions.onInbound(topic, payload);
	} else if (_.startsWith(topic, 'subscribe')) {
		operation = subscriptions.onSubscribe(topic, payload);
	} else if (_.startsWith(topic, '$aws/events/presence/disconnected')) {
		operation = subscriptions.onDisconnect(topic, payload);
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
			console.log(beautyError(err));
			callback(err);
		}
	);
};
