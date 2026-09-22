const test = require('node:test');
const assert = require('node:assert/strict');

const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const axiosPath = require.resolve('axios');

const mealPlan = id => ({
  id,
  meals: {
    days: [{
      meals: {
        breakfast: { name: 'Desayuno', recipe: { ingredients: [], steps: [] } }
      }
    }]
  }
});

function loadPortal(responses, timeoutMs = 100) {
  const calls = [];
  const state = { aborted: 0, activeAbortListeners: 0 };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
    }

    select() { return this; }
    eq(field, value) { this.filters.push([field, value]); return this; }
    is(field, value) { this.filters.push([field, value]); return this; }
    order() { return this; }
    limit() { return this; }
    single() { return this; }
    maybeSingle() { return this; }
    abortSignal(signal) { this.signal = signal; return this; }

    then(resolve, reject) {
      const response = responses[calls.length];
      calls.push({ table: this.table, filters: this.filters });

      if (!response) {
        reject(new Error(`Unexpected query ${calls.length} for ${this.table}`));
        return;
      }

      let timer;
      const onAbort = () => {
        state.aborted += 1;
        state.activeAbortListeners -= 1;
        clearTimeout(timer);
        reject(this.signal.reason);
      };

      if (this.signal) {
        state.activeAbortListeners += 1;
        this.signal.addEventListener('abort', onAbort, { once: true });
      }

      if (response.hang) return;

      timer = setTimeout(() => {
        if (this.signal) {
          this.signal.removeEventListener('abort', onAbort);
          state.activeAbortListeners -= 1;
        }
        resolve(response.result);
      }, response.delay || 0);
    }
  }

  const supabase = { from(table) { return new Query(table); } };
  const previousTimeout = process.env.PORTAL_REQUEST_TIMEOUT_MS;
  process.env.PORTAL_REQUEST_TIMEOUT_MS = String(timeoutMs);
  delete require.cache[serverPath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: supabase
  };
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: { post: async () => ({ status: 200 }) }
  };
  const app = require(serverPath);

  if (previousTimeout === undefined) delete process.env.PORTAL_REQUEST_TIMEOUT_MS;
  else process.env.PORTAL_REQUEST_TIMEOUT_MS = previousTimeout;

  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === '/p/:token' && candidate.route.methods.get
  );
  return { handler: layer.route.stack[0].handle, calls, state };
}

async function invoke(handler) {
  const result = { headers: {} };
  const response = {
    set(name, value) { result.headers[name] = value; return response; },
    status(code) { result.status = code; return response; },
    send(body) { result.status ||= 200; result.body = body; return response; },
    render(view, data) {
      result.status ||= 200;
      result.view = view;
      result.data = data;
      return response;
    }
  };
  await handler({ params: { token: 'private-token' } }, response);
  return result;
}

function successResponses(options = {}) {
  const delay = options.delay || 0;
  return [
    { delay, result: { data: { id: 'user-a', name: 'Ana' }, error: null } },
    { delay, result: { data: { id: 'program-a', status: 'active', start_date: '2026-08-01' }, error: null } },
    { delay, result: { data: { id: 'week-2', week_number: 2 }, error: null } },
    { delay, result: { data: mealPlan('plan-2'), error: null } },
    { delay, result: { data: { id: 'week-3', program_id: 'program-a', week_number: 3 }, error: null } },
    { delay, result: { data: mealPlan('plan-3'), error: null } },
    { delay, result: { data: { id: 'week-1' }, error: null } },
    { delay, result: { data: mealPlan('plan-1'), error: null } }
  ];
}

async function captureDiagnostics(callback) {
  const originalInfo = console.info;
  const entries = [];
  console.info = line => entries.push(JSON.parse(line));
  try {
    return { value: await callback(), entries };
  } finally {
    console.info = originalInfo;
  }
}

test('normal portal request renders unchanged and records all stage outcomes', async () => {
  const { handler, state } = loadPortal(successResponses(), 500);
  const { value: result, entries } = await captureDiagnostics(() => invoke(handler));

  assert.equal(result.status, 200);
  assert.equal(result.view, 'plan');
  assert.equal(result.data.plan.id, 'plan-2');
  assert.match(result.headers['X-Request-ID'], /^[0-9a-f-]{36}$/);
  assert.deepEqual(entries.map(entry => entry.stage), [
    'portal_user_lookup',
    'portal_program_lookup',
    'portal_current_week_lookup',
    'portal_current_meal_plan_lookup',
    'portal_successor_week_lookup',
    'portal_successor_meal_plan_lookup',
    'portal_previous_week_lookup',
    'portal_previous_meal_plan_lookup'
  ]);
  assert.ok(entries.every(entry => entry.outcome === 'success'));
  assert.doesNotMatch(
    JSON.stringify(entries),
    /private-token|user-a|Ana|authorization|supabase/i
  );
  assert.equal(state.activeAbortListeners, 0);
});

test('a user lookup that never resolves is aborted and returns a controlled 503', async () => {
  const { handler, state } = loadPortal([{ hang: true }], 100);
  const { value: result, entries } = await captureDiagnostics(() => invoke(handler));

  assert.equal(result.status, 503);
  assert.equal(result.view, 'plan');
  assert.equal(result.data.portalState.title, 'No pudimos cargar tu programa');
  assert.equal(result.headers['Retry-After'], '60');
  assert.equal(state.aborted, 1);
  assert.equal(state.activeAbortListeners, 0);
  assert.equal(entries.at(-1).stage, 'portal_user_lookup');
  assert.equal(entries.at(-1).outcome, 'timeout');
});

test('a later hung lookup reports its exact stage and returns 503', async () => {
  const responses = successResponses().slice(0, 2);
  responses.push({ hang: true });
  const { handler, state } = loadPortal(responses, 100);
  const { value: result, entries } = await captureDiagnostics(() => invoke(handler));

  assert.equal(result.status, 503);
  assert.equal(state.aborted, 1);
  assert.equal(entries.at(-1).stage, 'portal_current_week_lookup');
  assert.equal(entries.at(-1).outcome, 'timeout');
});

test('one request budget bounds cumulative successful query latency', async () => {
  const { handler, state } = loadPortal(successResponses({ delay: 35 }), 100);
  const startedAt = Date.now();
  const { value: result, entries } = await captureDiagnostics(() => invoke(handler));

  assert.equal(result.status, 503);
  assert.ok(Date.now() - startedAt < 250);
  assert.equal(state.aborted, 1);
  assert.equal(entries.at(-1).stage, 'portal_current_week_lookup');
  assert.equal(entries.at(-1).outcome, 'timeout');
});

test('ordinary Supabase errors retain existing behavior and are not timeouts', async () => {
  const responses = successResponses().slice(0, 1);
  responses.push({ result: { data: null, error: { code: 'database_unavailable' } } });
  const { handler, state } = loadPortal(responses, 500);
  const { value: result, entries } = await captureDiagnostics(() => invoke(handler));

  assert.equal(result.status, 500);
  assert.equal(result.body, 'Error al cargar el programa.');
  assert.equal(state.aborted, 0);
  assert.equal(state.activeAbortListeners, 0);
  assert.equal(entries.at(-1).outcome, 'database_error');
});

test('invalid portal tokens retain the existing 404 behavior', async () => {
  const { handler } = loadPortal([
    { result: { data: null, error: { code: 'PGRST116' } } }
  ], 500);
  const { value: result } = await captureDiagnostics(() => invoke(handler));

  assert.equal(result.status, 404);
  assert.equal(result.body, 'Usuaria no encontrada');
});
