const {
	Observable
} = require('rxjs');

const callSelf = index => Observable.of(index);
const callErr = () => Observable.throw(new Error('error'));

Observable.from([1,2,3,4,5])
	.mergeMap(index => {
		if(index === 3) {
			return callErr()
				.catch(err => {
					return Observable.of(null)
				});
		} 

		return callSelf(index);
	})
	.subscribe(
		console.log,
		console.log
	);
