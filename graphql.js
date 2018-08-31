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

module.exports = (graphql, schema) => {
	const {
		GraphQLError,
		execute,
		parse,
		specifiedRules,
		validate
	} = graphql;

	return {
		execute: args => execute({
			schema,
			document: args.document,
			rootValue: args.rootValue,
			contextValue: args.contextValue,
			variableValues: args.variableValues
		}),
		validate: source => {
			const documentAST = parse(source);
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
				document: documentAST,
				errors: [],
				name: documentAST.definitions[0].selectionSet.selections[0].name.value
			};
		}
	};
};
