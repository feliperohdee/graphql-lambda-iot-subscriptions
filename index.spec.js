process.env.IOT_ENDPOINT = 'iot.endpoint';
process.env.ACCESS_KEY_ID = 'accessKey';
process.env.SECRET_ACCESS_KEY = 'secretKey';

const _ = require('lodash');
const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const md5 = require('md5');
const beautyError = require('simple-beauty-error');
const graphql = require('graphql');
const rx = require('rxjs');
const rxop = require('rxjs/operators');
const {
    Request
} = require('rxjs-dynamodb-client');
const {
    GraphQLSchema
} = require('graphql');
const {
    Queries
} = require('./models');

const Subscriptions = require('./');
const testing = require('./testing');

chai.use(sinonChai);

const expect = chai.expect;

describe('index.js', () => {
    let subscriptions;

    before(() => {
        sinon.stub(Queries.prototype, 'createTable')
            .returns(rx.empty());
    });

    after(() => {
        Queries.prototype.createTable.restore();
    });

    beforeEach(() => {
        subscriptions = new Subscriptions({
            contextValue: {
                customContext: 'customContext'
            },
            events: testing.events,
            schema: testing.schema,
            graphql
        });
    });

    describe('constructor', () => {
        it('should throw if no events provided', () => {
            expect(() => new Subscriptions()).to.throw('events is required.');
        });

        it('should throw if no schema provided', () => {
            expect(() => new Subscriptions({
                events: testing.events
            })).to.throw('schema is required.');
        });

        it('should throw if no graphql provided', () => {
            expect(() => new Subscriptions({
                events: testing.events,
                schema: testing.schema
            })).to.throw('graphql is required.');
        });

        it('should have contextValue', () => {
            expect(subscriptions.contextValue).to.be.an('object');
        });

        it('should have custom dynamoDb', () => {
            const customDynamoDb = {};

            subscriptions = new Subscriptions({
                events: testing.events,
                schema: testing.schema,
                graphql,
                dynamoDb: customDynamoDb
            });

            expect(subscriptions.queries.dynamoDb).to.be.equal(customDynamoDb);
        });

        it('should have events', () => {
            expect(subscriptions.events).to.be.an('object');
        });

        it('should have schema', () => {
            expect(subscriptions.schema).to.be.instanceof(GraphQLSchema);
        });

        it('should have default topics', () => {
            expect(subscriptions.topics).to.deep.equal({
                inbound: 'subscriptions/inbound',
                subscribe: 'subscriptions/subscribe',
                disconnect: '$aws/events/presence/disconnected'
            });
        });

        it('should have custom topics', () => {
            subscriptions = new Subscriptions({
                events: testing.events,
                schema: testing.schema,
                graphql,
                topics: {
                    inbound: 'custom/inbound',
                    subscribe: 'custom/subscribe',
                    disconnect: 'custom/disconnected'
                }
            });

            expect(subscriptions.topics).to.deep.equal({
                inbound: 'custom/inbound',
                subscribe: 'custom/subscribe',
                disconnect: 'custom/disconnected'
            });
        });

        it('should have dynamoDb', () => {
            expect(subscriptions.dynamoDb).to.be.an('object');
        });

        it('should have hooks', () => {
            expect(subscriptions.hooks).to.be.an('object');
        });

        it('should have localQueries', () => {
            expect(subscriptions.localQueries).to.be.an('object');
        });

        it('should have queries with default tableName', () => {
            expect(subscriptions.queries).to.be.an('object');
            expect(subscriptions.queries.tableName).to.be.equal('graphqlSubscriptionQueries');
        });

        it('should have queries with custom tableName', () => {
            subscriptions = new Subscriptions({
                events: testing.events,
                schema: testing.schema,
                graphql,
                tableName: 'customTableName'
            });

            expect(subscriptions.queries.tableName).to.be.equal('customTableName');
        });

        it('should have iotPublish', () => {
            expect(subscriptions.iotPublish).to.be.a('function');
        });
    });

    describe('graphqlExecute', () => {
        it('should execute graphql query and return an Observable', done => {
            const validation = subscriptions.graphqlValidate(
                `subscription {
					onMessage {
						text
					}
				}`
            );

            subscriptions.graphqlExecute({
                    document: validation.document,
                    rootValue: {
                        text: 'Lorem ipsum dolor sit amet.'
                    }
                })
                .subscribe(response => {
                    expect(response).to.deep.equal({
                        data: {
                            onMessage: {
                                text: 'Lorem ipsum dolor sit amet.'
                            }
                        }
                    });
                }, null, done);
        });

        it('should execute with custom executor', done => {
            const executor = sinon.stub()
                .resolves({
                    data: {
                        onMessage: {
                            text: 'Lorem ipsum dolor sit amet.'
                        }
                    }
                });

            subscriptions.graphqlExecute({}, executor)
                .subscribe(response => {
                    expect(response).to.deep.equal({
                        data: {
                            onMessage: {
                                text: 'Lorem ipsum dolor sit amet.'
                            }
                        }
                    });
                }, null, done);
        });
    });

    describe('graphqlValidate', () => {
        it('should validate graphql query and return no errors and name', () => {
            const validation = subscriptions.graphqlValidate(`subscription {
				onMessage {
					text
				}
			}`);

            expect(validation).to.deep.equal({
                document: validation.document,
                errors: [],
                name: 'onMessage'
            });
        });

        it('should validate graphql query and return errors', () => {
            const validation = subscriptions.graphqlValidate(`subscription {
				onMessage {
					texts
				}
			}`);

            expect(validation).to.deep.equal({
                errors: validation.errors
            });
        });
    });

    describe('handle', () => {
        beforeEach(() => {
            sinon.stub(subscriptions, 'onInbound')
                .returns(rx.empty());

            sinon.stub(subscriptions, 'onSubscribe')
                .returns(rx.empty());

            sinon.stub(subscriptions, 'onDisconnect')
                .returns(rx.empty());
        });

        afterEach(() => {
            subscriptions.onInbound.restore();
            subscriptions.onSubscribe.restore();
            subscriptions.onDisconnect.restore();
        });

        it('should call onInbound', done => {
            subscriptions.handle('subscriptions/inbound/messages', {
                    text: 'Lorem ipsum dolor sit amet.'
                })
                .subscribe(null, null, () => {
                    expect(subscriptions.onInbound).to.have.been.calledWithExactly('subscriptions/inbound/messages', {
                        text: 'Lorem ipsum dolor sit amet.'
                    });
                    done();
                });
        });

        it('should call onSubscribe', done => {
            subscriptions.handle('subscriptions/subscribe', {
                    source: 'source'
                })
                .subscribe(null, null, () => {
                    expect(subscriptions.onSubscribe).to.have.been.calledWithExactly('subscriptions/subscribe', {
                        source: 'source'
                    });
                    done();
                });
        });

        it('should call onDisconnect', done => {
            subscriptions.handle('$aws/events/presence/disconnected', {
                    clientId: 'clientId'
                })
                .subscribe(null, null, () => {
                    expect(subscriptions.onDisconnect).to.have.been.calledWithExactly('$aws/events/presence/disconnected', {
                        clientId: 'clientId'
                    });
                    done();
                });
        });

        describe('error', () => {
            beforeEach(() => {
                subscriptions.onInbound.restore();

                sinon.stub(subscriptions, 'onInbound')
                    .onFirstCall()
                    .returns(rx.throwError('no beauty error'))
                    .onSecondCall()
                    .returns(rx.throwError(beautyError('beauty error')));
            });

            it('should handle beauty errors', done => {
                rx.merge(
                        subscriptions.handle('subscriptions/inbound/messages', {
                            text: 'Lorem ipsum dolor sit amet.'
                        })
                        .pipe(
                            rxop.catchError(err => {
                                expect(err.message).to.equal('no beauty error');
                                expect(err.context).to.be.an('object');

                                return rx.empty();
                            })
                        ),
                        subscriptions.handle('subscriptions/inbound/messages', {
                            text: 'Lorem ipsum dolor sit amet.'
                        })
                        .pipe(
                            rxop.catchError(err => {
                                expect(err.message).to.equal('beauty error');
                                expect(err.context).to.be.an('object');

                                return rx.empty();
                            })
                        )
                    )
                    .subscribe(null, null, done);
            });
        });
    });

    describe('publish', () => {
        beforeEach(() => {
            sinon.stub(subscriptions, 'iotPublish')
                .returns(rx.of({}));
        });

        afterEach(() => {
            subscriptions.iotPublish.restore();
        });

        it('should call iotPublish', done => {
            subscriptions.publish('topic', {
                    payload: 'payload'
                })
                .subscribe(() => {
                    expect(subscriptions.iotPublish).to.have.been.calledWithExactly({
                        topic: 'topic',
                        payload: JSON.stringify({
                            payload: 'payload'
                        }),
                        qos: 1
                    });
                }, null, done);
        });

        it('should return', done => {
            subscriptions.publish('topic', {
                    payload: 'payload'
                })
                .subscribe(response => {
                    expect(response).to.deep.equal({
                        publish: {
                            topic: 'topic',
                            payload: {
                                payload: 'payload'
                            }
                        }
                    });
                }, null, done);
        });

        describe('error', () => {
            let callback;

            beforeEach(() => {
                callback = sinon.stub();

                subscriptions.iotPublish.restore();
                sinon.stub(subscriptions, 'iotPublish')
                    .callsFake(() => {
                        const err = new Error('retryable error');

                        err.retryable = true;
                        err.retryDelay = 1;

                        return rx.throwError(err)
                            .pipe(
                                rxop.tap(null, err => {
                                    callback(err);
                                })
                            );
                    });
            });

            it('should retry times if retryable', done => {
                subscriptions.publish('topic', {
                        payload: 'payload'
                    })
                    .subscribe(null, err => {
                        expect(callback).to.have.callCount(6);
                        done();
                    });
            });

            it('should throw beautified error', done => {
                subscriptions.publish('topic', {
                        payload: 'payload'
                    })
                    .subscribe(null, err => {
                        expect(err.message).to.equal('retryable error');
                        expect(err.context).to.deep.equal({
                            scope: 'publish',
                            topic: 'topic',
                            payload: {
                                payload: 'payload'
                            }
                        });
                        done();
                    });
            });
        });
    });

    describe('onDisconnect', () => {
        beforeEach(() => {
            sinon.stub(subscriptions.queries, 'clear')
                .returns(rx.of({}));
        });

        afterEach(() => {
            subscriptions.queries.clear.restore();
        });

        it('should do nothing if no clientId', done => {
            const callback = sinon.stub();

            subscriptions.onDisconnect('topic', {})
                .subscribe(callback, null, () => {
                    expect(callback).not.to.have.been.called;
                    done();
                });
        });

        it('should call queries.clear', done => {
            subscriptions.onDisconnect('topic', {
                    clientId: 'clientId'
                })
                .subscribe(() => {
                    expect(subscriptions.queries.clear).to.have.been.calledWithExactly({
                        clientId: 'clientId'
                    });
                }, null, done);
        });

        it('should return', done => {
            subscriptions.onDisconnect('topic', {
                    clientId: 'clientId'
                })
                .subscribe(response => {
                    expect(response).to.deep.equal({
                        onDisconnect: {
                            clientId: 'clientId'
                        }
                    });
                }, null, done);
        });

        describe('hook', () => {
            beforeEach(() => {
                subscriptions.hooks.onDisconnect = sinon.stub()
                    .callsFake(args => rx.of(args));
            });

            afterEach(() => {
                subscriptions.hooks.onDisconnect = null;
            });

            it('should call hook', done => {
                subscriptions.onDisconnect('topic', {
                        clientId: 'clientId'
                    })
                    .subscribe(() => {
                        expect(subscriptions.hooks.onDisconnect).to.have.been.calledWithExactly({
                            topic: 'topic',
                            payload: {
                                clientId: 'clientId'
                            }
                        });
                    }, null, done);
            });
        });

        describe('error', () => {
            let callback;

            beforeEach(() => {
                callback = sinon.stub();

                subscriptions.queries.clear.restore();
                sinon.stub(subscriptions.queries, 'clear')
                    .callsFake(() => {
                        const err = new Error('retryable error');

                        err.retryable = true;
                        err.retryDelay = 1;

                        return rx.throwError(err)
                            .pipe(
                                rxop.tap(null, err => {
                                    callback(err);
                                })
                            );
                    });
            });

            it('should retry times if retryable', done => {
                subscriptions.onDisconnect('topic', {
                        clientId: 'clientId'
                    })
                    .subscribe(null, err => {
                        expect(callback).to.have.callCount(6);
                        done();
                    });
            });

            it('should throw beautified error', done => {
                subscriptions.onDisconnect('topic', {
                        clientId: 'clientId'
                    })
                    .subscribe(null, err => {
                        expect(err.message).to.equal('retryable error');
                        expect(err.context).to.deep.equal({
                            scope: 'onDisconnect',
                            clientId: 'clientId'
                        });
                        done();
                    });
            });

        });
    });

    describe('onSubscribe', () => {
        let query;
        let validation;

        beforeEach(() => {
            query = {
                contextValue: {
                    contextValue: 'contextValue'
                },
                source: `subscription {
					onMessage {
						text
					}
				}`,
                variableValues: {
                    variableValues: 'variableValues'
                }
            };

            validation = subscriptions.graphqlValidate(query.source);

            sinon.spy(testing.events.onMessage, 'inbound');
            sinon.spy(subscriptions, 'graphqlValidate');
            sinon.stub(subscriptions, 'publish')
                .returns(rx.of({}));
            sinon.stub(subscriptions.queries, 'insertOrUpdate')
                .returns(rx.of({}));

        });

        afterEach(() => {
            testing.events.onMessage.inbound.restore();
            subscriptions.graphqlValidate.restore();
            subscriptions.publish.restore();
            subscriptions.queries.insertOrUpdate.restore();
        });

        it('should do nothing if no clientId', done => {
            const callback = sinon.stub();

            subscriptions.onSubscribe('topic', {})
                .subscribe(callback, null, () => {
                    expect(callback).not.to.have.been.called;
                    done();
                });
        });

        it('should call query.inbound', done => {
            subscriptions.onSubscribe('topic', _.extend({}, query, {
                    clientId: 'clientId',
                    payload: {
                        payload: 'payload'
                    }
                }))
                .subscribe(() => {
                    expect(testing.events.onMessage.inbound).to.have.been.calledWithExactly('clientId', {
                        contextValue: query.contextValue,
                        name: 'onMessage',
                        source: query.source,
                        variableValues: query.variableValues
                    }, {
                        payload: {
                            payload: 'payload'
                        }
                    });
                }, null, done);
        });

        it('should call queries.insertOrUpdate', done => {
            const queryString = JSON.stringify({
                contextValue: query.contextValue,
                name: validation.name,
                source: query.source,
                variableValues: query.variableValues
            });

            const id1 = md5('subscriptions/inbound/messages' + queryString);
            const id2 = md5('subscriptions/inbound/anotherMessages' + queryString);

            subscriptions.onSubscribe('topic', _.extend({}, query, {
                    clientId: 'clientId'
                }))
                .subscribe(() => {
                    expect(subscriptions.queries.insertOrUpdate).to.have.been.calledTwice;

                    const [args] = subscriptions.queries.insertOrUpdate.firstCall.args;

                    expect(subscriptions.queries.insertOrUpdate).to.have.been.calledWithExactly({
                        clientId: 'clientId',
                        document: JSON.stringify(validation.document),
                        id: id1,
                        query: queryString,
                        topic: 'subscriptions/inbound/messages',
                        ttl: args.ttl
                    });

                    expect(subscriptions.queries.insertOrUpdate).to.have.been.calledWithExactly({
                        clientId: 'clientId',
                        document: JSON.stringify(validation.document),
                        id: id2,
                        query: queryString,
                        topic: 'subscriptions/inbound/anotherMessages',
                        ttl: args.ttl
                    });
                }, null, done);
        });

        it('should return', done => {
            subscriptions.onSubscribe('topic', _.extend({}, query, {
                    clientId: 'clientId'
                }))
                .subscribe(response => {
                    expect(response).to.deep.equal([{
                        onSubscribe: {
                            clientId: 'clientId',
                            id: 'f5a169cb0c74edb234bfa48d41dd8d34',
                            source: 'subscription {\n\t\t\t\t\tonMessage {\n\t\t\t\t\t\ttext\n\t\t\t\t\t}\n\t\t\t\t}',
                            topic: 'subscriptions/inbound/messages'
                        }
                    }, {
                        onSubscribe: {
                            clientId: 'clientId',
                            id: '84ea095f8160c7dc7497a701e1500e45',
                            source: 'subscription {\n\t\t\t\t\tonMessage {\n\t\t\t\t\t\ttext\n\t\t\t\t\t}\n\t\t\t\t}',
                            topic: 'subscriptions/inbound/anotherMessages'
                        }
                    }]);
                }, null, done);
        });

        it('should not duplicate query to same client', done => {
            rx.forkJoin(
                    subscriptions.onSubscribe('topic', _.extend({}, query, {
                        clientId: 'clientId'
                    })),
                    subscriptions.onSubscribe('topic', _.extend({}, query, {
                        clientId: 'clientId'
                    }))
                )
                .subscribe(([
                    subscribe1,
                    subscribe2
                ]) => {
                    expect(subscribe1[0].onSubscribe.clientId).to.equal(subscribe2[0].onSubscribe.clientId);
                    expect(subscribe1[0].onSubscribe.id).be.a('string');
                    expect(subscribe2[0].onSubscribe.id).be.a('string');
                    expect(subscribe1[0].onSubscribe.id).to.equal(subscribe2[0].onSubscribe.id);

                    expect(subscribe1[1].onSubscribe.clientId).to.equal(subscribe2[1].onSubscribe.clientId);
                    expect(subscribe1[1].onSubscribe.id).be.a('string');
                    expect(subscribe2[1].onSubscribe.id).be.a('string');
                    expect(subscribe1[1].onSubscribe.id).to.equal(subscribe2[1].onSubscribe.id);
                }, null, done);
        });

        it('should return empty if no inbound', done => {
            query.source = `subscription {
				onChange {
					text
				}
			}`;

            subscriptions.onSubscribe('topic', _.extend({}, query, {
                    clientId: 'clientId'
                }))
                .subscribe(response => {
                    expect(response.length).to.equal(0);
                }, null, done);
        });

        describe('with localQuery', () => {
            beforeEach(() => {
                subscriptions.localQueries.onMessage = sinon.stub();
            });

            afterEach(() => {
                subscriptions.localQueries = {};
            });

            it('should return', done => {
                subscriptions.onSubscribe('topic', _.extend({}, query, {
                        source: 'onMessage',
                        clientId: 'clientId'
                    }))
                    .subscribe(response => {
                        expect(response).to.deep.equal([{
                            onSubscribe: {
                                clientId: 'clientId',
                                id: '4c6dd53c8f5945cb4955fdf1b79bca4f',
                                source: 'onMessage',
                                topic: 'subscriptions/inbound/messages'
                            }
                        }, {
                            onSubscribe: {
                                clientId: 'clientId',
                                id: 'ccc08b317429a964b300992967b9a391',
                                source: 'onMessage',
                                topic: 'subscriptions/inbound/anotherMessages'
                            }
                        }]);
                    }, null, done);
            });
        });

        describe('hook', () => {
            beforeEach(() => {
                subscriptions.hooks.onSubscribe = sinon.stub()
                    .callsFake(args => rx.of(args));
            });

            afterEach(() => {
                subscriptions.hooks.onSubscribe = null;
            });

            it('should call hook', done => {
                subscriptions.onSubscribe('topic', _.extend({}, query, {
                        clientId: 'clientId'
                    }))
                    .subscribe(() => {
                        expect(subscriptions.hooks.onSubscribe).to.have.been.calledWithExactly({
                            topic: 'topic',
                            payload: _.extend({}, query, {
                                clientId: 'clientId'
                            })
                        });
                    }, null, done);
            });
        });

        describe('no source', () => {
            it('should send error to client', done => {
                query.source = null;

                subscriptions.onSubscribe('topic', _.extend({}, query, {
                        clientId: 'clientId'
                    }))
                    .subscribe(null, err => {
                        const args = subscriptions.publish.firstCall.args;

                        expect(subscriptions.publish).to.have.been.calledWithExactly('clientId', {
                            errors: args[1].errors
                        });
                        done();
                    });
            });

            it('should throw beautified error', done => {
                query.source = null;

                subscriptions.onSubscribe('topic', _.extend({}, query, {
                        clientId: 'clientId'
                    }))
                    .subscribe(null, err => {
                        expect(err.message).to.equal('no source provided.');
                        expect(err.context).to.deep.equal({
                            scope: 'onSubscribe',
                            clientId: 'clientId'
                        });
                        done();
                    });
            });
        });

        describe('validation', () => {
            it('should call graphqlValidate', done => {
                subscriptions.onSubscribe('topic', _.extend({}, query, {
                        clientId: 'clientId'
                    }))
                    .subscribe(() => {
                        expect(subscriptions.graphqlValidate).to.have.been.calledWithExactly(query.source);
                    }, null, done);
            });

            it('should send invalidations to client', done => {
                query.source = `subscription {
					onMessage {
						texts
					}
				}`;

                subscriptions.onSubscribe('topic', _.extend({}, query, {
                        clientId: 'clientId'
                    }))
                    .subscribe(null, err => {
                        const args = subscriptions.publish.firstCall.args;

                        expect(subscriptions.publish).to.have.been.calledWithExactly('clientId', {
                            errors: args[1].errors
                        });
                        expect(args[1].errors[0].message).to.equal('Cannot query field "texts" on type "Message". Did you mean "text"?');

                        done();
                    });
            });

            it('should not send invalidations to client if no mqtt', done => {
                query.source = `subscription {
					onMessage {
						texts
					}
				}`;

                subscriptions.onSubscribe(null, _.extend({}, query, {
                        clientId: 'clientId'
                    }))
                    .subscribe(null, err => {
                        expect(subscriptions.publish).not.to.have.been.called;

                        done();
                    });
            });

            it('should throw beautified error', done => {
                query.source = `subscription {
					onMessage {
						texts
					}
				}`;

                subscriptions.onSubscribe(null, _.extend({}, query, {
                        clientId: 'clientId'
                    }))
                    .subscribe(null, err => {
                        expect(err.message).to.equal('invalid source.');
                        expect(err.context).to.have.all.keys([
                            'scope',
                            'clientId',
                            'contextValue',
                            'errors',
                            'source',
                            'variableValues'
                        ]);
                        expect(err.context.scope).to.equal('onSubscribe');

                        done();
                    });
            });
        });

        describe('insertOrUpdate error', () => {
            let callback;

            beforeEach(() => {
                callback = sinon.stub();

                subscriptions.queries.insertOrUpdate.restore();
                sinon.stub(subscriptions.queries, 'insertOrUpdate')
                    .callsFake(() => {
                        const err = new Error('retryable error');

                        err.retryable = true;
                        err.retryDelay = 1;

                        return rx.throwError(err)
                            .pipe(
                                rxop.tap(null, err => {
                                    callback(err);
                                })
                            );
                    });
            });

            it('should retry times if retryable', done => {
                subscriptions.onSubscribe('topic', _.extend({}, query, {
                        clientId: 'clientId'
                    }))
                    .subscribe(null, err => {
                        expect(callback).to.have.callCount(11);
                        done();
                    });
            });

            it('should throw beautified error', done => {
                subscriptions.onSubscribe('topic', _.extend({}, query, {
                        clientId: 'clientId'
                    }))
                    .subscribe(null, err => {
                        expect(err.message).to.equal('retryable error');
                        expect(err.context).to.have.all.keys([
                            'scope',
                            'clientId',
                            'contextValue',
                            'id',
                            'source',
                            'variableValues',
                            'topic'
                        ]);
                        expect(err.context.scope).to.equal('onSubscribe.insert');
                        done();
                    });
            });
        });
    });

    describe('onInbound', () => {
        let query;
        let queryString;
        let validation;
        let documentString;

        beforeEach(() => {
            query = {
                contextValue: {
                    contextValue: 'contextValue'
                },
                source: `subscription {
					onMessage {
						text
					}
				}`,
                name: 'onMessage',
                variableValues: {
                    variableValues: 'variableValues'
                }
            };

            subscriptions.localQueries = {
                onMessage: sinon.stub()
                    .resolves({
                        data: {
                            onMessage: {
                                text: 'text'
                            }
                        }
                    })
            };

            validation = subscriptions.graphqlValidate(query.source);
            queryString = JSON.stringify(query);
            documentString = JSON.stringify(validation.document);

            sinon.stub(Request.prototype, 'query')
                .returns(rx.of({
                    clientId: 'clientId',
                    document: documentString,
                    id: 'id-1',
                    query: queryString
                }, {
                    clientId: 'clientId1',
                    document: documentString,
                    id: 'id-1',
                    query: queryString
                }, {
                    clientId: 'clientId2',
                    document: documentString,
                    id: 'id-1',
                    query: queryString
                }, {
                    clientId: 'clientId3',
                    document: documentString,
                    id: 'id-2',
                    query: JSON.stringify(_.extend({}, query, {
                        name: 'inexistent'
                    }))
                }, {
                    clientId: 'clientId4',
                    document: JSON.stringify(''),
                    id: 'id-3',
                    query: JSON.stringify(_.extend({}, query, {
                        source: 'onMessage'
                    }))
                }));

            sinon.stub(subscriptions, 'publish')
                .callsFake((topic, payload) => rx.of({
                    publish: {
                        topic,
                        payload
                    }
                }));

            sinon.spy(testing.events.onMessage, 'outbound');
            sinon.spy(subscriptions, 'graphqlExecute');
        });

        afterEach(() => {
            Request.prototype.query.restore();
            testing.events.onMessage.outbound.restore();
            subscriptions.graphqlExecute.restore();
            subscriptions.localQueries = {};
        });

        it('should call queries.query', done => {
            subscriptions.onInbound('topic', {
                    text: 'text'
                })
                .subscribe(null, null, () => {
                    expect(Request.prototype.query).to.have.been.calledWithExactly('#topic = :topic');
                    done();
                });
        });

        it('should call graphQlExecute and localQuery', done => {
            subscriptions.onInbound('topic', {
                    text: 'text'
                })
                .subscribe(null, null, () => {
                    expect(subscriptions.graphqlExecute).to.have.callCount(2);
                    expect(subscriptions.graphqlExecute).to.have.been.calledWithExactly({
                        contextValue: _.extend({}, subscriptions.contextValue, query.contextValue),
                        document: JSON.parse(documentString),
                        rootValue: {
                            text: 'text'
                        },
                        variableValues: query.variableValues
                    }, undefined);

                    expect(subscriptions.graphqlExecute).to.have.been.calledWithExactly({
                        contextValue: _.extend({}, subscriptions.contextValue, query.contextValue),
                        document: '',
                        rootValue: {
                            text: 'text'
                        },
                        variableValues: query.variableValues
                    }, subscriptions.localQueries.onMessage);
                    done();
                });
        });

        it('should call query.outbound', done => {
            subscriptions.onInbound('topic', {
                    text: 'text'
                })
                .subscribe(null, null, () => {
                    expect(subscriptions.publish).to.have.callCount(8);
                    expect(testing.events.onMessage.outbound).to.have.callCount(4);
                    expect(testing.events.onMessage.outbound).to.have.been.calledWithExactly('clientId', query, {
                        text: 'text'
                    });
                    expect(testing.events.onMessage.outbound).to.have.been.calledWithExactly('clientId1', query, {
                        text: 'text'
                    });
                    expect(testing.events.onMessage.outbound).to.have.been.calledWithExactly('clientId2', query, {
                        text: 'text'
                    });
                    expect(testing.events.onMessage.outbound).to.have.been.calledWithExactly('clientId4', _.extend({}, query, {
                        source: 'onMessage'
                    }), {
                        text: 'text'
                    });
                    expect(subscriptions.publish).to.have.been.calledWithExactly('another', {
                        data: {
                            onMessage: {
                                text: 'text'
                            }
                        }
                    });
                    done();
                });
        });

        it('should return', done => {
            subscriptions.onInbound('topic', {
                    text: 'text'
                })
                .subscribe(response => {
                    expect(response).to.deep.equal([{
                        publish: {
                            payload: {
                                data: {
                                    onMessage: {
                                        text: 'text'
                                    }
                                }
                            },
                            topic: 'clientId'
                        }
                    }, {
                        publish: {
                            payload: {
                                data: {
                                    onMessage: {
                                        text: 'text'
                                    }
                                }
                            },
                            topic: 'another'
                        }
                    }, {
                        publish: {
                            payload: {
                                data: {
                                    onMessage: {
                                        text: 'text'
                                    }
                                }
                            },
                            topic: 'clientId1'
                        }
                    }, {
                        publish: {
                            payload: {
                                data: {
                                    onMessage: {
                                        text: 'text'
                                    }
                                }
                            },
                            topic: 'another'
                        }
                    }, {
                        publish: {
                            payload: {
                                data: {
                                    onMessage: {
                                        text: 'text'
                                    }
                                }
                            },
                            topic: 'clientId2'
                        }
                    }, {
                        publish: {
                            payload: {
                                data: {
                                    onMessage: {
                                        text: 'text'
                                    }
                                }
                            },
                            topic: 'another'
                        }
                    }, {
                        publish: {
                            payload: {
                                data: {
                                    onMessage: {
                                        text: 'text'
                                    }
                                }
                            },
                            topic: 'clientId4'
                        }
                    }, {
                        publish: {
                            payload: {
                                data: {
                                    onMessage: {
                                        text: 'text'
                                    }
                                }
                            },
                            topic: 'another'
                        }
                    }]);
                }, null, done);
        });

        describe('hook', () => {
            beforeEach(() => {
                subscriptions.hooks.onInbound = sinon.stub()
                    .callsFake(args => rx.of(args));
            });

            afterEach(() => {
                subscriptions.hooks.onInbound = null;
            });

            it('should call hook', done => {
                subscriptions.onInbound('topic', {
                        text: 'text'
                    })
                    .subscribe(() => {
                        expect(subscriptions.hooks.onInbound).to.have.been.calledWithExactly({
                            topic: 'topic',
                            payload: {
                                text: 'text'
                            }
                        });
                    }, null, done);
            });
        });

        describe('query error', () => {
            let callback;

            beforeEach(() => {
                callback = sinon.stub();

                Request.prototype.query.restore();
                sinon.stub(Request.prototype, 'query')
                    .callsFake(() => {
                        const err = new Error('retryable error');

                        err.retryable = true;
                        err.retryDelay = 10;

                        return rx.throwError(err)
                            .pipe(
                                rxop.tap(null, err => {
                                    callback(err);
                                })
                            );
                    });
            });

            it('should retry times if retryable', done => {
                subscriptions.onInbound('topic', {
                        text: 'text'
                    })
                    .subscribe(null, err => {
                        expect(callback).to.have.callCount(6);
                        done();
                    });
            });

            it('should throw beautified error', done => {
                subscriptions.onInbound('topic', {
                        text: 'text'
                    })
                    .subscribe(null, err => {
                        expect(err.message).to.equal('retryable error');
                        expect(err.context).to.have.all.keys([
                            'scope',
                            'topic'
                        ]);
                        expect(err.context.scope).to.equal('onInbound.fetchTopics');

                        done();
                    });
            });
        });

        describe('publish error', () => {
            beforeEach(() => {
                subscriptions.publish.restore();
                sinon.stub(subscriptions, 'publish')
                    .onFirstCall()
                    .returns(rx.throwError(new Error('error')))
                    .callsFake((topic, payload) => rx.of({
                        publish: {
                            topic,
                            payload
                        }
                    }));
            });

            it('should suppress errors to avoid break the chain', done => {
                subscriptions.onInbound('topic', {
                        text: 'text'
                    })
                    .pipe(
                        rxop.toArray()
                    )
                    .subscribe(response => {
                        expect(response[0][0].message).to.equal('error');
                        expect(response[0][1]).to.deep.equal({
                            publish: {
                                topic: 'another',
                                payload: {
                                    data: {
                                        onMessage: {
                                            text: 'text'
                                        }
                                    }
                                }
                            }
                        });
                    }, null, done);
            });
        });
    });
});