const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const rx = require('rxjs');

const onRetryableError = require('./onRetryableError');

chai.use(sinonChai);

const expect = chai.expect;

describe('onRetryableError.js', () => {
    let fn;
    let callback;
    let err;

    beforeEach(() => {
        callback = sinon.stub();
        err = new Error();
        err.code = 'LimitExceededException';
        err.statusCode = 400;
        err.retryable = true;
        fn = () => {
            let index = 0;

            return new rx.Observable(subscriber => {
                err.retryDelay = index++;
                callback();

                subscriber.error(err);
            });
        };
    });

    it('should retry 1x by default', done => {
        fn()
            .pipe(
                onRetryableError()
            )
            .subscribe(null, err => {
                expect(callback).to.have.been.callCount(2);
                expect(err.retryDelay).to.equal(1);

                done();
            });
    });

    it('should retry 2x', done => {
        fn()
            .pipe(
                onRetryableError(() => 2)
            )
            .subscribe(null, err => {
                expect(callback).to.have.been.callCount(3);
                expect(err.retryDelay).to.equal(2);

                done();
            });
    });

    it('should retry 3x', done => {
        fn()
            .pipe(
                onRetryableError(3)
            )
            .subscribe(null, err => {
                expect(callback).to.have.been.callCount(4);
                expect(err.retryDelay).to.equal(3);

                done();
            });
    });

    it('should retry 3x by 50ms (150ms total)', done => {
        fn()
            .pipe(
                onRetryableError({
                    max: 3,
                    delay: 50
                })
            )
            .subscribe(null, err => {
                expect(callback).to.have.been.callCount(4);
                expect(err.retryDelay).to.equal(3);

                done();
            });
    });

    it('should retry 4x', done => {
        fn()
            .pipe(
                onRetryableError((err, index) => ({
                    max: 10,
                    retryable: index >= 4 ? false : err.retryable
                }))
            )
            .subscribe(null, err => {
                expect(callback).to.have.been.callCount(5);
                expect(err.retryDelay).to.equal(4);

                done();
            });
    });

    describe('not retryable', () => {
        beforeEach(() => {
            err.retryable = false;
        });

        it('should not retry', done => {
            fn()
                .pipe(
                    onRetryableError()
                )
                .subscribe(null, err => {
                    expect(callback).to.have.been.callCount(1);
                    expect(err.retryDelay).to.equal(0);

                    done();
                });
        });
    });
});