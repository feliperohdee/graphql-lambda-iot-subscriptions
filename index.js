const _ = require('lodash');
const md5 = require('md5');
const AWS = require('./AWS');
const graphqlFactory = require('./graphql');
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

const eventHook = (args, hook) => Observable.of(args)
    .mergeMap(args => {
        if (_.isFunction(hook)) {
            return hook(args);
        }

        return Observable.of(args);
    });

module.exports = class Subscriptions {
    constructor(args = {}) {
        const {
            contextValue,
            dynamoDb = null,
            events,
            graphql,
            hooks = {},
            localQueries = {},
            schema,
            tableName = 'graphqlSubscriptionQueries',
            topics
        } = args;

        if (!events) {
            throw new Error('events is required.');
        }

        if (!schema) {
            throw new Error('schema is required.');
        }

        if (!graphql) {
            throw new Error('graphql is required.');
        }

        this.contextValue = contextValue;
        this.events = events;
        this.schema = schema;
        this.topics = _.defaults(topics, {
            inbound: 'subscriptions/inbound',
            subscribe: 'subscriptions/subscribe',
            disconnect: '$aws/events/presence/disconnected'
        });
        this.graphql = graphqlFactory(graphql, schema);
        this.hooks = hooks;
        this.localQueries = localQueries;

        this.dynamoDb = dynamoDb || new DynamoDB({
            client: AWS.dynamoDb
        });

        this.queries = new Queries(this, tableName);
        this.iotPublish = Observable.bindNodeCallback(AWS.iot.publish.bind(AWS.iot));
    }

    graphqlExecute(args, execute) {
        const result = execute ? execute(args) : this.graphql.execute(args);

        if (result.then) {
            return Observable.fromPromise(result);
        }

        return Observable.of(result);
    }

    graphqlValidate(source) {
        return this.graphql.validate(source);
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
        return eventHook({
                topic,
                payload
            }, this.hooks.onDisconnect)
            .mergeMap(({
                topic,
                payload
            }) => {
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
            });
    }

    onSubscribe(topic, payload) {
        return eventHook({
                topic,
                payload
            }, this.hooks.onSubscribe)
            .mergeMap(({
                topic,
                payload
            }) => {
                const {
                    clientId = null,
                        contextValue = {},
                        source = null,
                        variableValues = {}
                } = payload;

                const isMqtt = !!topic;
                const exclusivePayload = _.omit(payload, [
                    'clientId',
                    'contextValue',
                    'source',
                    'variableValues'
                ]);

                if (!clientId) {
                    return Observable.empty();
                }

                if (!source) {
                    return this.publish(clientId, {
                            errors: [
                                beautyError('no source provided.')
                            ]
                        })
                        .mergeMap(() => Observable.throw(beautyError('no source provided.', {
                            scope: 'onSubscribe',
                            clientId
                        })));
                }

                const localQuery = this.localQueries[source];
                const query = {
                    contextValue,
                    source,
                    variableValues
                };

                if (localQuery) {
                    query.name = source;
                } else {
                    const validation = this.graphqlValidate(source);

                    if (_.size(validation.errors)) {
                        isMqtt && this.publish(clientId, {
                            errors: validation.errors
                        });

                        return Observable.throw(beautyError('invalid source.', {
                            scope: 'onSubscribe',
                            clientId,
                            contextValue,
                            errors: validation.errors,
                            source,
                            variableValues
                        }));
                    }

                    query.document = validation.document;
                    query.name = validation.name;
                }

                const queryEvent = this.events[query.name];
                const inbound = queryEvent && queryEvent.inbound(clientId, {
                    contextValue: query.contextValue,
                    name: query.name,
                    source: query.source,
                    variableValues: query.variableValues
                }, exclusivePayload);

                if (_.size(inbound)) {
                    const documentString = localQuery ? null : JSON.stringify(query.document);
                    const queryString = JSON.stringify({
                        contextValue: query.contextValue,
                        name: query.name,
                        source: query.source,
                        variableValues: query.variableValues
                    });

                    return Observable.from(inbound)
                        .mergeMap(topic => {
                            const id = md5(topic + queryString);

                            return this.queries.insertOrUpdate({
                                    clientId,
                                    document: documentString,
                                    id,
                                    topic,
                                    query: queryString,
                                    ttl: _.floor((_.now() / 1000) + 43200) // 12 hours
                                })
                                .mapTo({
                                    onSubscribe: {
                                        clientId,
                                        id,
                                        source,
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
                                    id,
                                    source,
                                    variableValues,
                                    topic
                                })));
                        })
                        .toArray();
                }

                return Observable.of([]);
            });
    }

    onInbound(topic, payload) {
        return eventHook({
                topic,
                payload
            }, this.hooks.onInbound)
            .mergeMap(({
                topic,
                payload
            }) => {
                const topics = this.queries.request
                    .index('topic')
                    .addPlaceholderName('topic')
                    .addPlaceholderValue({
                        topic
                    })
                    .query('#topic = :topic')
                    .reduce((reduction, {
                        id,
                        clientId,
                        document,
                        query
                    }) => {
                        if (!reduction[id]) {
                            reduction[id] = {
                                clientIds: [clientId],
                                document,
                                query
                            };
                        } else {
                            reduction[id] = _.extend({}, reduction[id], {
                                clientIds: reduction[id].clientIds.concat(clientId)
                            });
                        }

                        return reduction;
                    }, {})
                    .mergeMap(response => {
                        return Observable.from(_.values(response));
                    })
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
                        clientIds,
                        document,
                        query
                    }) => {
                        query = JSON.parse(query);

                        const events = this.events[query.name];
                        const outbound = events ? _.flatMap(clientIds, clientId => {
                                return events.outbound(clientId, query, payload);
                            })
                            .filter(Boolean) : [];

                        if (_.size(outbound)) {
                            const localQuery = this.localQueries[query.source];

                            return this.graphqlExecute({
                                    contextValue: _.extend({}, this.contextValue, query.contextValue),
                                    document: JSON.parse(document),
                                    rootValue: payload,
                                    variableValues: query.variableValues
                                }, localQuery)
                                .mergeMap(response => {
                                    return Observable.from(outbound)
                                        .mergeMap(topic => {
                                            // suppress error early to not break the chain
                                            return this.publish(topic, response)
                                                .catch(err => Observable.of(err));
                                        });
                                });
                        }

                        return Observable.of([]);
                    })
                    .reduce((reduction, response) => {
                        return reduction.concat(response);
                    }, []);
            });
    }
}