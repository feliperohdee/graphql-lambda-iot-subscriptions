const {
	GraphQLError,
	graphql,
	parse,
	specifiedRules,
	validate
} = require('graphql');

const subscriptionHasSingleRootField = context => {
	return {
		OperationDefinition: node => {
			const operationName = node.name ? node.name.value : '';
			let numFields = 0;

			node.selectionSet.selections
				.forEach(selection => {
					const {
						kind,
						name
					} = selection;

					if (kind === 'Field') {
						numFields++;
					} else {
						context.reportError(new GraphQLError('Subscriptions do not support fragments on the root field.', [
							node
						]));
					}
				});

			if (numFields > 1) {
				let err = `Subscription "${operationName}" must have only one field.`;

				if (!operationName) {
					err = `Subscription must have only one field.`;
				}

				context.reportError(new GraphQLError(err, [
					node
				]));
			}

			return false;
		}
	};
}

module.exports = {
	execute: (schema, requestString, rootValue, contextValue, variableValues) => {
		return graphql(schema, requestString, rootValue, contextValue, variableValues);
	},
	validate: (schema, requestString) => {
		const documentAST = parse(requestString);
		const errors = validate(
			schema,
			documentAST,
			specifiedRules.concat([
				subscriptionHasSingleRootField
			])
		);

		if(errors.length) {
			return {
				errors
			};
		}

		return {
			errors: [],
			queryName: documentAST.definitions[0].selectionSet.selections[0].name.value
		};
	}
};
