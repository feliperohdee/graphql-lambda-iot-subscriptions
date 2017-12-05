const _ = require('lodash');
const AWS = require('./AWS');
const graphql = require('./graphql');
const models = require('./models');
const {
	Observable
} = require('rxjs');
const {
	DynamoDB
} = require('smallorange-dynamodb-client');

module.exports = class App {
	constructor() {
		this.queries = {};
		this.dynamoDb = new DynamoDB({
			client: AWS.dynamoDb
		});

		this.models = {
			queries: new models.Queries(this)
		};
	}

	graphqlExecute(args) {
		const {
			requestString = null,
			rootValue = {},
			contextValue = {},
			variableValues = {}
		} = args;

		return Observable.fromPromise(graphql.execute(requestString, rootValue, _.extend({}, this, contextValue), variableValues));
	}

	graphqlValidate(requestString) {
		return graphql.validate(requestString);
	}

	publish(topic, payload) {
		AWS.iot.publish({
			topic,
			payload: _.isString(payload) ? payload : JSON.stringify(payload),
			qos: 1
		}, (err, data) => {
			console.log(`publish ${topic}`);
			console.log(err, data);
		});
	}

	onDisconnect(topic, payload) {
		const {
			clientId = null
		} = payload;

		if (!clientId) {
			return Observable.throw('no clientId provided.');
		}

		return this.models.queries.clear({
				clientId
			})
			.retryWhen(err => err.map((err, index) => {
					if (index >= 5) {
						throw err;
					}

					return err;
				})
				.delay(500));
	}

	onSubscribe(topic, payload) {
		const {
			clientId = null,
			contextValue = {},
			requestString = null,
			variableValues = {}
		} = payload;

		const nonQueryPayload = _.omit(payload, [
			'clientId',
			'contextValue',
			'requestString',
			'variableValues'
		]);

		if (!clientId) {
			return Observable.throw('no clientId provided.');
		}

		if (!requestString) {
			this.publish(clientId, {
				error: 'no requestString provided.'
			});

			return Observable.throw('no requestString provided.');
		}

		const {
			errors,
			queryName
		} = this.graphqlValidate(requestString);

		if (errors.length) {
			this.publish(clientId, {
				error: errors
			});

			return Observable.throw(errors);
		}

		const queryObj = {
			contextValue,
			queryName,
			requestString,
			variableValues
		};

		const query = this.queries[queryName];
		const inbound = query && query.inbound(clientId, queryObj, nonQueryPayload);

		if (inbound.length) {
			const queryString = JSON.stringify(queryObj);

			return Observable.from(inbound)
				.mergeMap(topic => {
					return this.models.queries.insertOrReplace({
						clientId,
						topic,
						query: queryString
					});
				});
		}

		return Observable.empty();
	}

	onInbound(topic, payload) {
		const topics = this.models.queries.request
			.index('topic')
			.addPlaceholderName('topic')
			.addPlaceholderValue({
				topic
			})
			.query('#topic = :topic');

		return topics.mergeMap(({
			clientId,
			query
		}) => {
			const queryObj = JSON.parse(query);
			const outbound = this.queries[queryObj.queryName].outbound(clientId, queryObj, payload);

			if (outbound.length) {
				return this.graphqlExecute(_.extend({}, queryObj, {
						rootValue: payload
					}))
					.do(response => {
						outbound && topic, outbound.forEach(topic => this.publish(topic, response));
					});
			}

			return Observable.of(null);
		});
	}
}
