[![CircleCI](https://circleci.com/gh/feliperohdee/smallorange-lambda-iot-graphql-subscriptions.svg?style=svg)](https://circleci.com/gh/feliperohdee/smallorange-lambda-iot-graphql-subscriptions)

# Small Orange Lambda/Iot GraphQL Subscriptions 

## API
	constructor(
		events: {
			[eventName]: {
				inbound: (clientId:string, queryObj:object, payload:object):Array<string>
				outbound: (clientId:string, queryObj:object, payload:object):Array<string>
			}
		},
		schema: GraphQLSchema,
		topics: {
			inbound:string, // default subscriptions/inbound
			subscribe:string, // default subscriptions/subscribe
			disconnect:string // default $aws/events/presence/disconnected
		},
		tableName:string // default graphqlSubscriptionQueries
	);

	handle(topic:string, payload:object): void;

# Usage

## 1. Setup AWS Iot

At AWS Iot Console, go to Rules (ACT) and create three rules:

	1.1 Name: onDisconnect
	   Query: SELECT * as payload, topic() as topic, 'mqttIncoming' as type FROM '$aws/events/presence/disconnected/#'
	   Action: Call lambda function

	1.2 Name: onInbound
	   Query: SELECT * as payload, topic() as topic, clientid() as payload.clientId, 'mqttIncoming' as type FROM 'subscriptions/inbound/#'
	   Action: Call lambda function

	1.3 Name: onSubscribe
	   Query: SELECT * as payload, topic() as topic, clientid() as payload.clientId, 'mqttIncoming' as type FROM 'subscriptions/subscribe'
	   Action: Call lambda function

	1.4 You can optionally create a fallback rule at "Error action", at each rule screen, following the defaults actions.

## 2. Create Lambda Function

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
			// what topic shoul trigger onMessage queries
			inbound: (clientId, queryObj, payload) => {
				return [
					'subscriptions/inbound/messages',
					'subscriptions/inbound/anotherMessages'
				];
			},
			// what topics should results be delivered, you can create custom rules accordin to user authentication, ...
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

## 3. Almost Done

In security credentials, register an user who have full access to DynamoDb*.
In your lambda setup, register the following environment variables:

* Lambda function needs access to DynamoDb, where it register subscriptions. You can define via Access Role or via user.

- IOT_ENDPOINT: (required, available on Aws Iot console > settings)
- SECRET_ACCESS_KEY: *** (optional)
- ACCESS_KEY_ID: *** (optional)
- AWS_REGION: *** (optional, default us-east-1)

Now, each time AWS Iot receives one message a pre defined topics "onSubscribe", "onInbound" and "onDisconnect", it will route messages to this lambda function. The lambda function is gonna take care to register subscriptions on "onSubscribe", run queries "onInbound" and tear down on "onDisconnect".

Optionally you can define a TTL rule on DynamoDB to remove old queries in case of "onDisconnect" fails for any reason.
You can see the logs via Cloud Watch Logs.

Enjoy!

		
