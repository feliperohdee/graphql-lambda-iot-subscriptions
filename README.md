[![CircleCI](https://circleci.com/gh/feliperohdee/smallorange-lambda-iot-graphql-subscriptions.svg?style=svg)](https://circleci.com/gh/feliperohdee/smallorange-lambda-iot-graphql-subscriptions)

# Small Orange Lambda/Iot GraphQL Subscriptions 

## Sample

	const {
		GraphQLSchema,
		GraphQLObjectType,
		GraphQLString
	} = require('graphql');

	const Subscriptions = require('smallorange-lambda-iot-graphql-subscriptions');

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
				},
				onChange: {
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
					'subscriptions/inbound/messages',
					'subscriptions/inbound/anotherMessages'
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

		
