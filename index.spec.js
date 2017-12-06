process.env.IOT_ENDPOINT = 'iot.endpoint';
process.env.ACCESS_KEY_ID = 'accessKey';
process.env.SECRET_ACCESS_KEY = 'secretKey';

const _ = require('lodash');
const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const beautyError = require('smallorange-beauty-error');
const {
	Observable
} = require('rxjs');
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
			.returns(Observable.empty());
	});

	after(() => {
		Queries.prototype.createTable.restore();
	});

	beforeEach(() => {
		subscriptions = new Subscriptions(testing.events, testing.schema);
	});

	describe('constructor', () => {
		it('should throw if no events provided', () => {
			expect(() => new Subscriptions()).to.throw('events is required.');
		});

		it('should throw if no schema provided', () => {
			expect(() => new Subscriptions(testing.events)).to.throw('schema is required.');
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
			subscriptions = new Subscriptions(testing.events, testing.schema, {
				inbound: 'custom/inbound',
				subscribe: 'custom/subscribe',
				disconnect: 'custom/disconnected'
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

		it('should have queries with default tableName', () => {
			expect(subscriptions.queries).to.be.an('object');
			expect(subscriptions.queries.tableName).to.be.equal('graphqlSubscriptionQueries');
		});

		it('should have queries with custom tableName', () => {
			subscriptions = new Subscriptions(testing.events, testing.schema, {}, 'customTableName');

			expect(subscriptions.queries.tableName).to.be.equal('customTableName');
		});

		it('should have iotPublish', () => {
			expect(subscriptions.iotPublish).to.be.a('function');
		});
	});

	describe('graphqlExecute', () => {
		it('should execute graphql query and return an Observable', done => {
			subscriptions.graphqlExecute({
					requestString: `subscription {
						onMessage {
							text
						}
					}`,
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
	});

	describe('graphqlValidate', () => {
		it('should validate graphql query and return no errors and queryName', () => {
			const result = subscriptions.graphqlValidate(`subscription {
				onMessage {
					text
				}
			}`);

			expect(result).to.deep.equal({
				errors: [],
				queryName: 'onMessage'
			});
		});

		it('should validate graphql query and return errors', () => {
			const result = subscriptions.graphqlValidate(`subscription {
				onMessage {
					texts
				}
			}`);

			expect(result).to.deep.equal({
				errors: result.errors
			});
		});
	});

	describe('handle', () => {
		beforeEach(() => {
			sinon.stub(subscriptions, 'onInbound')
				.returns(Observable.empty());

			sinon.stub(subscriptions, 'onSubscribe')
				.returns(Observable.empty());

			sinon.stub(subscriptions, 'onDisconnect')
				.returns(Observable.empty());
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
					requestString: 'requestString'
				})
				.subscribe(null, null, () => {
					expect(subscriptions.onSubscribe).to.have.been.calledWithExactly('subscriptions/subscribe', {
						requestString: 'requestString'
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
					.returns(Observable.throw('no beauty error'))
					.onSecondCall()
					.returns(Observable.throw(beautyError('beauty error')));
			});

			it('should handle beauty errors', done => {
				Observable.merge(
						subscriptions.handle('subscriptions/inbound/messages', {
							text: 'Lorem ipsum dolor sit amet.'
						})
						.catch(err => {
							expect(err.message).to.equal('no beauty error');
							expect(err.context).to.be.an('object');

							return Observable.empty();
						}),
						subscriptions.handle('subscriptions/inbound/messages', {
							text: 'Lorem ipsum dolor sit amet.'
						})
						.catch(err => {
							expect(err.message).to.equal('beauty error');
							expect(err.context).to.be.an('object');

							return Observable.empty();
						})
					)
					.subscribe(null, null, done);
			});
		});
	});

	describe('publish', () => {
		beforeEach(() => {
			sinon.stub(subscriptions, 'iotPublish')
				.returns(Observable.of({}));
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

						return Observable.throw(err)
							.do(null, err => {
								callback(err);
							});
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
						expect(err.context).to.be.an('object');
						done();
					});
			});
		});
	});

	describe('onDisconnect', () => {
		it('should do nothing if no clientId');
		it('should call queries.clear');
		it('should return');

		describe('error', () => {
			it('should retry times if retryable');
			it('should throw beautified error');
		});
	});

	describe('onSubscribe', () => {
		it('should do nothing if no clientId');
		it('should call queries.insertOrUpdate');
		it('should return');
		it('should not duplicate query to same client');
		it('should return empty if no matched query');

		describe('no requestString', () => {
			it('should send error to client');
			it('should throw');
		});

		describe('validation', () => {
			it('should call graphqlValidate');
			it('should send invalidations to client');
			it('should not send invalidations to client if no mqtt');
			it('should throw');
		});

		describe('error', () => {
			it('should retry times if retryable');
			it('should throw beautified error');
		});
	});

	describe('onInbound', () => {
		it('should call queries.query');
		it('should call graphQlExecute');
		it('should publish to each client each outbound topic');
		it('should return');

		describe('publish error', () => {
			it('should suppress errors to avoid break the chain');
		});

		describe('error', () => {
			it('should retry times if retryable');
			it('should throw beautified error');
		});
	});
});
