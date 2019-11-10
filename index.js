const _ = require('lodash');
const beautyError = require('simple-beauty-error');
const md5 = require('md5');
const rx = require('rxjs');
const rxop = require('rxjs/operators');

const AWS = require('./AWS');
const graphqlFactory = require('./graphql');
const onRetryableError = require('./onRetryableError');
const {
    Queries
} = require('./models');
const {
    DynamoDB
} = require('rxjs-dynamodb-client');

const eventHook = (args, hook) => rx.of(args)
    .pipe(
        rxop.mergeMap(args => {
            if (_.isFunction(hook)) {
                return hook(args);
            }

            return rx.of(args);
        })
    );

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
        this.iotPublish = rx.bindNodeCallback(AWS.iot.publish.bind(AWS.iot));
    }

    graphqlExecute(args, execute) {
        const result = execute ? execute(args) : this.graphql.execute(args);

        if (result.then) {
            return rx.from(result);
        }

        return rx.of(result);
    }

    graphqlValidate(source) {
        return this.graphql.validate(source);
    }

    handle(topic, payload) {
        let operation = rx.empty();

        if (_.startsWith(topic, this.topics.inbound)) {
            operation = this.onInbound(topic, payload);
        } else if (_.startsWith(topic, this.topics.subscribe)) {
            operation = this.onSubscribe(topic, payload);
        } else if (_.startsWith(topic, this.topics.disconnect)) {
            operation = this.onDisconnect(topic, payload);
        }

        return operation.pipe(
            rxop.catchError(err => rx.throwError(err.context ? err : beautyError(err)))
        );
    }

    publish(topic, payload) {
        return this.iotPublish({
                topic,
                payload: _.isString(payload) ? payload : JSON.stringify(payload),
                qos: 1
            })
            .pipe(
                rxop.mapTo({
                    publish: {
                        topic,
                        payload
                    }
                }),
                onRetryableError(err => ({
                    retryable: err.retryable,
                    delay: err.retryDelay,
                    max: 5
                })),
                rxop.catchError(err => rx.throwError(beautyError(err, {
                    scope: 'publish',
                    topic,
                    payload
                })))
            );
    }

    onDisconnect(topic, payload) {
        return eventHook({
                topic,
                payload
            }, this.hooks.onDisconnect)
            .pipe(
                rxop.mergeMap(({
                    topic,
                    payload
                }) => {
                    const {
                        clientId = null
                    } = payload;

                    if (!clientId) {
                        return rx.empty();
                    }

                    return this.queries.clear({
                            clientId
                        })
                        .pipe(
                            rxop.mapTo({
                                onDisconnect: {
                                    clientId
                                }
                            }),
                            onRetryableError(err => ({
                                retryable: err.retryable,
                                delay: err.retryDelay,
                                max: 5
                            })),
                            rxop.catchError(err => rx.throwError(beautyError(err, {
                                scope: 'onDisconnect',
                                clientId
                            })))
                        );
                })
            );
    }

    onSubscribe(topic, payload) {
        return eventHook({
                topic,
                payload
            }, this.hooks.onSubscribe)
            .pipe(
                rxop.mergeMap(({
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
                        return rx.empty();
                    }

                    if (!source) {
                        return this.publish(clientId, {
                                errors: [
                                    beautyError('no source provided.')
                                ]
                            })
                            .pipe(
                                rxop.mergeMap(() => rx.throwError(beautyError('no source provided.', {
                                    scope: 'onSubscribe',
                                    clientId
                                })))
                            );
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

                            return rx.throwError(beautyError('invalid source.', {
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

                        return rx.from(inbound)
                            .pipe(
                                rxop.mergeMap(topic => {
                                    const id = md5(topic + queryString);

                                    return this.queries.insertOrUpdate({
                                            clientId,
                                            document: documentString,
                                            id,
                                            topic,
                                            query: queryString,
                                            ttl: _.floor((_.now() / 1000) + 43200) // 12 hours
                                        })
                                        .pipe(
                                            rxop.mapTo({
                                                onSubscribe: {
                                                    clientId,
                                                    id,
                                                    source,
                                                    topic
                                                }
                                            }),
                                            onRetryableError(err => ({
                                                retryable: err.retryable,
                                                delay: err.retryDelay,
                                                max: 5
                                            })),
                                            rxop.catchError(err => rx.throwError(beautyError(err, {
                                                scope: 'onSubscribe.insert',
                                                clientId,
                                                contextValue,
                                                id,
                                                source,
                                                variableValues,
                                                topic
                                            })))
                                        );
                                }),
                                rxop.toArray()
                            );
                    }

                    return rx.of([]);
                })
            );
    }

    onInbound(topic, payload) {
        return eventHook({
                topic,
                payload
            }, this.hooks.onInbound)
            .pipe(
                rxop.mergeMap(({
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
                        .pipe(
                            rxop.reduce((reduction, {
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
                            }, {}),
                            rxop.mergeMap(response => {
                                return rx.from(_.values(response));
                            }),
                            onRetryableError(err => ({
                                retryable: err.retryable,
                                delay: err.retryDelay,
                                max: 5
                            })),
                            rxop.catchError(err => rx.throwError(beautyError(err, {
                                scope: 'onInbound.fetchTopics',
                                topic
                            })))
                        );
    
                    return topics.pipe(
                        rxop.mergeMap(({
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
                                    .pipe(
                                        rxop.mergeMap(response => {
                                            return rx.from(outbound)
                                                .pipe(
                                                    rxop.mergeMap(topic => {
                                                        // suppress error early to not break the chain
                                                        return this.publish(topic, response)
                                                            .pipe(
                                                                rxop.catchError(err => rx.of(err))
                                                            );
                                                    })
                                                );
                                        })
                                    );
                            }
    
                            return rx.of([]);
                        }),
                        rxop.reduce((reduction, response) => {
                            return reduction.concat(response);
                        }, [])
                    );
                })
            );
    }
};