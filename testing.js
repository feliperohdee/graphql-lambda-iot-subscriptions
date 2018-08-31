const {
	GraphQLSchema,
	GraphQLObjectType,
	GraphQLString
} = require('graphql');

const Subscriptions = require('./');

const Message = new GraphQLObjectType({
	name: 'Message',
	fields: {
		text: {
			type: GraphQLString
		}
	}
});

const schema = exports.schema = new GraphQLSchema({
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
			},
			onChange: {
				type: Message,
				// args: {},
				resolve: root => root
			}
		}
	})
});

const events = exports.events = {
	onMessage: {
		inbound: (clientId, query, payload) => {
			return [
				'subscriptions/inbound/messages',
				'subscriptions/inbound/anotherMessages',
			];
		},
		outbound: (clientId, query, payload) => {
			return [
				clientId,
				'another'
			];
		}
	}
};

exports.handler = (event, context, callback) => {
	if (event.type === 'mqttIncoming') {
		const subscriptions = new Subscriptions(events, schema);
		const {
			payload,
			topic
		} = event;

		return subscriptions.handle(topic, payload)
			.subscribe(
				response => {
					console.log(JSON.stringify(response, null, 2));

					callback(null, response);
				},
				err => {
					console.log(JSON.stringify(err, null, 2));

					callback(null, null);
				}
			);
	}

	callback(null, null);
};
