class PortalRequestTimeoutError extends Error {
  constructor() {
    super('Portal request deadline exceeded');
    this.name = 'PortalRequestTimeoutError';
  }
}

function portalRequestTimeoutMs(value = process.env.PORTAL_REQUEST_TIMEOUT_MS) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 30000
    ? parsed
    : 8000;
}

function createPortalDeadline({ requestId, timeoutMs, log = console.info }) {
  const controller = new AbortController();
  const startedAt = Date.now();
  let expired = false;
  let finishTimeout;

  const expiration = new Promise(resolve => {
    finishTimeout = setTimeout(() => {
      expired = true;
      controller.abort(new PortalRequestTimeoutError());
      resolve({ deadlineExpired: true });
    }, timeoutMs);
  });

  function diagnostic(stage, stageStartedAt, outcome) {
    log(JSON.stringify({
      event: 'portal_query_stage',
      request_id: requestId,
      stage,
      elapsed_ms: Date.now() - stageStartedAt,
      outcome
    }));
  }

  async function run(stage, buildQuery) {
    const stageStartedAt = Date.now();
    let queryPromise;
    let diagnosticRecorded = false;

    const record = outcome => {
      diagnosticRecorded = true;
      diagnostic(stage, stageStartedAt, outcome);
    };

    try {
      if (expired || Date.now() - startedAt >= timeoutMs) {
        if (!expired) {
          expired = true;
          controller.abort(new PortalRequestTimeoutError());
        }
        record('timeout');
        throw new PortalRequestTimeoutError();
      }

      let query = buildQuery();
      if (query && typeof query.abortSignal === 'function') {
        query = query.abortSignal(controller.signal);
      }

      queryPromise = Promise.resolve(query).then(
        value => ({ value }),
        error => ({ error })
      );

      const result = await Promise.race([queryPromise, expiration]);

      if (result?.deadlineExpired || expired) {
        record('timeout');
        throw new PortalRequestTimeoutError();
      }

      if (result.error) {
        record('database_error');
        throw result.error;
      }

      record(result.value?.error ? 'database_error' : 'success');
      return result.value;
    } catch (error) {
      if (error instanceof PortalRequestTimeoutError) throw error;
      if (expired || controller.signal.aborted) {
        if (!diagnosticRecorded) record('timeout');
        throw new PortalRequestTimeoutError();
      }
      if (!diagnosticRecorded) record('database_error');
      throw error;
    }
  }

  function finish() {
    clearTimeout(finishTimeout);
  }

  return { run, finish, signal: controller.signal };
}

module.exports = {
  PortalRequestTimeoutError,
  createPortalDeadline,
  portalRequestTimeoutMs
};
