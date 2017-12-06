const _ = require('lodash');
const cuid = require('cuid');
const {
	Crud
} = require('smallorange-dynamodb-client');

const tableName = 'graphqlSubscriptionQueries';
const tableSchema = {
	primaryKeys: {
		partition: 'clientId',
		sort: 'id'
	},
	indexes: {
		topic: {
			partition: 'topic'
		}
	}
};

module.exports = class Queries extends Crud {
	constructor(app) {
		super(tableName, tableSchema, {
			dynamoDb: app.dynamoDb
		});

		this.app = app;

		this.createTable()
			.subscribe(() => null);
	}

	deleteTable() {
		return this.request
			.routeCall('deleteTable', {
				TableName: tableName
			});
	}

	createTable() {
		return this.request
			.describe()
			.catch(() => this.request
				.routeCall('createTable', {
					TableName: tableName,
					ProvisionedThroughput: {
						ReadCapacityUnits: 1,
						WriteCapacityUnits: 1
					},
					AttributeDefinitions: [{
						AttributeName: 'clientId',
						AttributeType: 'S'
					}, {
						AttributeName: 'id',
						AttributeType: 'S'
					}, {
						AttributeName: 'topic',
						AttributeType: 'S'
					}],
					KeySchema: [{
						AttributeName: 'clientId',
						KeyType: 'HASH'
					}, {
						AttributeName: 'id',
						KeyType: 'RANGE'
					}],
					GlobalSecondaryIndexes: [{
						IndexName: 'topic',
						KeySchema: [{
							AttributeName: 'topic',
							KeyType: 'HASH'
						}],
						Projection: {
							ProjectionType: 'ALL'
						},
						ProvisionedThroughput: {
							ReadCapacityUnits: 1,
							WriteCapacityUnits: 1
						}
					}]
				}));
	}
}
