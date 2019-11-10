const {
	Crud
} = require('rxjs-dynamodb-client');

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
	constructor(app, tableName) {
		super(tableName, tableSchema, {
			dynamoDb: app.dynamoDb
		});
		
		this.tableName = tableName;
		this.app = app;

		this.createTable()
			.subscribe(() => null, console.log);
	}

	deleteTable() {
		return this.request
			.routeCall('deleteTable', {
				TableName: this.tableName
			});
	}

	createTable() {
		return this.request
			.describe()
			.catch(() => this.request
				.routeCall('createTable', {
					TableName: this.tableName,
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
};
