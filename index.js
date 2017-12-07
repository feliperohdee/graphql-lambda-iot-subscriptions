const _ = require('lodash');
const md5 = require('md5');
const AWS = require('./AWS');
const graphql = require('./graphql');
const beautyError = require('smallorange-beauty-error');
const {
	Queries
} = require('./models');
const {
	Observable
} = require('rxjs');
const {
	DynamoDB
} = require('smallorange-dynamodb-client');

Observable.prototype.onRetryableError = function(callback = {}) {
	const source = this;

	return source.retryWhen(err => err.mergeMap((err, index) => {
		let error = _.isFunction(callback) ? callback(err, index) : callback;

		if (_.isNumber(error)) {
			error = {
				max: error
			};
		}

		error = _.defaults({}, error, {
			retryable: !_.isUndefined(err.retryable) ? err.retryable : false,
			delay: !_.isUndefined(err.retryDelay) ? err.retryDelay : 1000,
			max: 1
		});

		if (error && error.retryable && index < error.max) {
			return Observable.of(err)
				.delay(error.delay);
		}

		return Observable.throw(err);
	}));
};

module.exports = class Subscriptions {
	constructor(events, schema, topics, tableName = 'graphqlSubscriptionQueries') {
		if(!events) {
			throw new Error('events is required.');
		}

		if(!schema) {
			throw new Error('schema is required.');
		}

		this.events = events;
		this.schema = schema;
		this.topics = _.defaults(topics, {
			inbound: 'subscriptions/inbound',
			subscribe: 'subscriptions/subscribe',
			disconnect: '$aws/events/presence/disconnected'
		});

		this.dynamoDb = new DynamoDB({
			client: AWS.dynamoDb
		});

		this.queries = new Queries(this, tableName);
		this.iotPublish = Observable.bindNodeCallback(AWS.iot.publish.bind(AWS.iot));
	}

	graphqlExecute(args) {
		const {
			requestString = null,
			rootValue = {},
			contextValue = {},
			variableValues = {}
		} = args;

		return Observable.fromPromise(graphql.execute(this.schema, requestString, rootValue, _.extend({}, this, contextValue), variableValues));
	}

	graphqlValidate(requestString) {
		return graphql.validate(this.schema, requestString);
	}

	handle(topic, payload) {
		let operation = Observable.empty();

		if (_.startsWith(topic, this.topics.inbound)) {
			operation = this.onInbound(topic, payload);
		} else if (_.startsWith(topic, this.topics.subscribe)) {
			operation = this.onSubscribe(topic, payload);
		} else if (_.startsWith(topic, this.topics.disconnect)) {
			operation = this.onDisconnect(topic, payload);
		}

		return operation.catch(err => Observable.throw(err.context ? err : beautyError(err)));
	}

	publish(topic, payload) {
		return this.iotPublish({
				topic,
				payload: _.isString(payload) ? payload : JSON.stringify(payload),
				qos: 1
			})
			.mapTo({
				publish: {
					topic,
					payload
				}
			})
			.onRetryableError(err => ({
				retryable: err.retryable,
				delay: err.retryDelay,
				max: 5
			}))
			.catch(err => Observable.throw(beautyError(err, {
				scope: 'publish',
				topic,
				payload
			})));
	}

	onDisconnect(topic, payload) {
		const {
			clientId = null
		} = payload;

		if (!clientId) {
			return Observable.empty();
		}

		return this.queries.clear({
				clientId
			})
			.mapTo({
				onDisconnect: {
					clientId
				}
			})
			.onRetryableError(err => ({
				retryable: err.retryable,
				delay: err.retryDelay,
				max: 5
			}))
			.catch(err => Observable.throw(beautyError(err, {
				scope: 'onDisconnect',
				clientId
			})));
	}

	onSubscribe(topic, payload) {
		const {
			clientId = null,
			contextValue = {},
			requestString = null,
			variableValues = {}
		} = payload;
		
		const isMqtt = !!topic;
		const nonQueryPayload = _.omit(payload, [
			'clientId',
			'contextValue',
			'requestString',
			'variableValues'
		]);

		if (!clientId) {
			return Observable.empty();
		}

		if (!requestString) {
			return this.publish(clientId, {
					errors: [
						beautyError('no requestString provided.')
					]
				})
				.mergeMap(() => Observable.throw(beautyError('no requestString provided.', {
					scope: 'onSubscribe',
					clientId
				})));
		}

		const {
			errors,
			queryName
		} = this.graphqlValidate(requestString);

		if (errors && errors.length) {
			isMqtt && this.publish(clientId, {
				errors
			});

			return Observable.throw(beautyError('invalid requestString.', {
				scope: 'onSubscribe',
				clientId,
				contextValue,
				errors,
				requestString,
				variableValues
			}));
		}

		const queryObj = {
			contextValue,
			queryName,
			requestString,
			variableValues
		};

		const query = this.events[queryName];
		const inbound = query && query.inbound(clientId, queryObj, nonQueryPayload);

		if (inbound && inbound.length) {
			const queryString = JSON.stringify(queryObj);

			return Observable.from(inbound)
				.mergeMap(topic => {
					const id = md5(topic + queryString);

					return this.queries.insertOrUpdate({
							clientId,
							id,
							topic,
							query: queryString,
							ttl: _.floor((_.now() / 1000) + 43200) // 12 hours
						})
						.mapTo({
							onSubscribe: {
								clientId,
								id,
								requestString,
								topic
							}
						})
						.onRetryableError(err => ({
							retryable: err.retryable,
							delay: err.retryDelay,
							max: 5
						}))
						.catch(err => Observable.throw(beautyError(err, {
							scope: 'onSubscribe.insert',
							clientId,
							contextValue,
							errors,
							id,
							requestString,
							variableValues,
							topic
						})));
				})
				.toArray();
		}

		return Observable.of([]);
	}

	onInbound(topic, payload) {
		const topics = this.queries.request
			.index('topic')
			.addPlaceholderName('topic')
			.addPlaceholderValue({
				topic
			})
			.query('#topic = :topic')
			.onRetryableError(err => ({
				retryable: err.retryable,
				delay: err.retryDelay,
				max: 5
			}))
			.catch(err => Observable.throw(beautyError(err, {
				scope: 'onInbound.fetchTopics',
				topic
			})));

		return topics.mergeMap(({
			clientId,
			query
		}) => {
			const queryObj = JSON.parse(query);
			const events = this.events[queryObj.queryName];
			const outbound = events && events.outbound(clientId, queryObj, payload);

			if (outbound && outbound.length) {
				return this.graphqlExecute(_.extend({}, queryObj, {
						rootValue: payload
					}))
					.mergeMap(response => {
						return Observable.from(outbound)
							.mergeMap(topic => {
								// suppress error early to not break the chain
								return this.publish(topic, response)
									.catch(err => Observable.of(err));
							})
							.toArray();
					});
			}

			return Observable.of([]);
		});
	}

	getTopics() {

	}
}
