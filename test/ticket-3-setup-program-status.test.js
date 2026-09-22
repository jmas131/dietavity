const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');

const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const axiosPath = require.resolve('axios');

function matches(row, filters) {
  return filters.every(([field, value]) => row[field] === value);
}

function loadApp(initialState = {}) {
  const state = {
    users: initialState.users || [],
    profiles: initialState.profiles || [],
    programs: initialState.programs || [],
    weeks: initialState.weeks || [],
    meal_plans: initialState.meal_plans || [],
    profileUpserts: [],
    setupEvents: new Map(),
    setupEventRpcCalls: [],
    userUpdates: [],
    webhookCalls: [],
    failNameUpdate: initialState.failNameUpdate || false,
    failProfileRead: initialState.failProfileRead || false,
    failProfileUpsert: initialState.failProfileUpsert || false,
    failSetupEvent: initialState.failSetupEvent || false
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.updateValues = null;
      this.ascending = true;
      this.rowLimit = null;
    }

    select() { return this; }
    limit(value) { this.rowLimit = value; return this; }
    order(field, options = {}) {
      this.orderField = field;
      this.ascending = options.ascending !== false;
      return this;
    }
    eq(field, value) { this.filters.push([field, value]); return this; }
    update(values) { this.updateValues = values; return this; }

    async upsert(values) {
      state.profileUpserts.push(values);
      if (state.failProfileUpsert) {
        return { data: null, error: { message: 'profile upsert failed' } };
      }
      const existing = state.profiles.find(row => row.user_id === values.user_id);
      if (existing) Object.assign(existing, values);
      else state.profiles.push({ ...values });
      return { data: null, error: null };
    }

    rows() {
      let rows = state[this.table].filter(row => matches(row, this.filters));
      if (this.orderField) {
        const direction = this.ascending ? 1 : -1;
        rows = [...rows].sort((a, b) =>
          String(a[this.orderField]).localeCompare(String(b[this.orderField])) * direction
        );
      }
      return this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
    }

    async single() {
      const row = this.rows()[0] || null;
      return row
        ? { data: row, error: null }
        : { data: null, error: { message: 'not found' } };
    }

    async maybeSingle() {
      if (this.updateValues) {
        if (this.table === 'users') {
          state.userUpdates.push({ ...this.updateValues });
        }
        if (state.failNameUpdate) {
          return { data: null, error: { message: 'update failed' } };
        }
        const row = this.rows()[0] || null;
        if (!row) return { data: null, error: null };
        Object.assign(row, this.updateValues);
        return { data: row, error: null };
      }
      if (this.table === 'profiles' && state.failProfileRead) {
        return { data: null, error: { message: 'profile read failed' } };
      }
      return { data: this.rows()[0] || null, error: null };
    }
  }

  const supabase = {
    from(table) { return new Query(table); },
    async rpc(name, args) {
      assert.equal(name, 'persist_setup_completed_event');
      state.setupEventRpcCalls.push({ name, args: { ...args } });
      if (state.failSetupEvent) {
        return { data: null, error: { message: 'database unavailable' } };
      }
      if (state.setupEvents.has(args.target_event_key)) {
        return { data: false, error: null };
      }
      state.setupEvents.set(args.target_event_key, {
        session_id: args.target_session_id,
        user_id: args.target_user_id,
        event_type: 'setup_completed',
        event_key: args.target_event_key,
        metadata: {}
      });
      return { data: true, error: null };
    }
  };

  const axios = {
    async post(url, body) {
      state.webhookCalls.push({ url, body });
      return { status: 202, data: {} };
    }
  };

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
    exports: axios
  };

  return { app: require(serverPath), state };
}

function routeHandler(app, method, routePath) {
  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === routePath && candidate.route.methods[method]
  );
  return layer.route.stack[0].handle;
}

async function invoke(handler, request = {}) {
  const result = {};
  const response = {
    status(code) { result.status = code; return response; },
    send(body) { result.status ||= 200; result.body = body; return response; },
    json(body) { result.status ||= 200; result.body = body; return response; },
    redirect(location) { result.status = 302; result.location = location; return response; },
    render(view, data) { result.status ||= 200; result.view = view; result.data = data; return response; }
  };
  await handler({ headers: {}, params: {}, query: {}, body: {}, ...request }, response);
  return result;
}

function validProfile(name) {
  return {
    name,
    sensitive_data_consent: 'true',
    birth_month: '3',
    birth_year: '1990',
    height_cm: '165',
    weight_kg: '60',
    eating_style: 'omnivore',
    allergies: ['dairy'],
    medical_conditions: [],
    foods_to_avoid: 'apio, hinojo',
    notes: 'Sin horno'
  };
}

test('setup rejects missing sensitive-data consent before persistence or generation', async () => {
  const { app, state } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a', name: 'Nombre anterior' }],
    profiles: [{ user_id: 'user-a', allergies: ['eggs'] }]
  });
  const handler = routeHandler(app, 'post', '/setup/:portal_token');
  const body = validProfile('Ana');
  delete body.sensitive_data_consent;

  const result = await invoke(handler, {
    params: { portal_token: 'token-a' },
    body
  });

  assert.equal(result.status, 400);
  assert.match(result.body, /consentimiento/i);
  assert.equal(state.users[0].name, 'Nombre anterior');
  assert.deepEqual(state.profiles[0].allergies, ['eggs']);
  assert.equal(state.profileUpserts.length, 0);
  assert.equal(state.userUpdates.length, 0);
  assert.equal(state.webhookCalls.length, 0);
});

test('setup saves a valid name for a new user', async () => {
  process.env.PROGRAM_GENERATION_WEBHOOK_URL = 'https://example.test/generate';
  const { app, state } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a', name: null }]
  });
  const handler = routeHandler(app, 'post', '/setup/:portal_token');

  const result = await invoke(handler, {
    params: { portal_token: 'token-a' },
    body: validProfile('Ana')
  });

  assert.equal(result.status, 302);
  assert.equal(state.users[0].name, 'Ana');
  assert.equal(state.profileUpserts.length, 1);
  assert.equal(state.profileUpserts[0].privacy_notice_version, '2026-08-11');
  assert.ok(Number.isFinite(Date.parse(state.profileUpserts[0].sensitive_data_consent_at)));
  assert.equal(state.webhookCalls.length, 1);
  assert.deepEqual(
    [...state.setupEvents.values()],
    [{
      session_id: null,
      user_id: 'user-a',
      event_type: 'setup_completed',
      event_key: 'setup_completed:user-a:2026-08-11',
      metadata: {}
    }]
  );
});

test('setup retry with an existing program treats the duplicate event as a no-op', async () => {
  const { app, state } = loadApp({
    users: [{
      id: 'user-a', portal_token: 'token-a',
      whatsapp_id: '5215550000000', name: 'Ana'
    }],
    profiles: [{
      user_id: 'user-a',
      sensitive_data_consent_at: '2026-08-11T12:00:00.000Z',
      privacy_notice_version: '2026-08-11'
    }],
    programs: [{ id: 'program-a', user_id: 'user-a' }]
  });
  const handler = routeHandler(app, 'post', '/setup/:portal_token');

  const first = await invoke(handler, {
    params: { portal_token: 'token-a' }, body: validProfile('Ana')
  });
  const retry = await invoke(handler, {
    params: { portal_token: 'token-a' }, body: validProfile('Ana')
  });

  assert.equal(first.status, 302);
  assert.equal(retry.status, 302);
  assert.equal(retry.location, '/p/token-a');
  assert.equal(state.webhookCalls.length, 0);
  assert.equal(state.setupEventRpcCalls.length, 2);
  assert.equal(state.setupEvents.size, 1);
  assert.equal(
    state.setupEvents.get('setup_completed:user-a:2026-08-11').session_id,
    '5215550000000'
  );
});

test('a genuine setup event database failure remains a controlled error', async () => {
  process.env.PROGRAM_GENERATION_WEBHOOK_URL = 'https://example.test/generate';
  const { app, state } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a', name: null }],
    failSetupEvent: true
  });
  const handler = routeHandler(app, 'post', '/setup/:portal_token');

  const result = await invoke(handler, {
    params: { portal_token: 'token-a' }, body: validProfile('Ana')
  });

  assert.equal(result.status, 500);
  assert.match(result.body, /no pudimos confirmar su finalización/i);
  assert.equal(state.profileUpserts.length, 1);
  assert.equal(state.userUpdates.length, 1);
  assert.equal(state.webhookCalls.length, 1);
  assert.equal(state.setupEvents.size, 0);
});

test('setup ignores client-supplied consent evidence and stores server-controlled values', async () => {
  process.env.PROGRAM_GENERATION_WEBHOOK_URL = 'https://example.test/generate';
  const beforeSubmission = Date.now();
  const { app, state } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a', name: null }]
  });
  const handler = routeHandler(app, 'post', '/setup/:portal_token');
  const body = {
    ...validProfile('Ana'),
    sensitive_data_consent_at: '1999-01-01T00:00:00.000Z',
    privacy_notice_version: 'attacker-controlled-value'
  };

  const result = await invoke(handler, {
    params: { portal_token: 'token-a' },
    body
  });
  const persisted = state.profileUpserts[0];
  const persistedTimestamp = Date.parse(persisted.sensitive_data_consent_at);

  assert.equal(result.status, 302);
  assert.equal(persisted.privacy_notice_version, '2026-08-11');
  assert.notEqual(persisted.sensitive_data_consent_at, body.sensitive_data_consent_at);
  assert.ok(persistedTimestamp >= beforeSubmission);
  assert.ok(persistedTimestamp <= Date.now());
  assert.equal(state.webhookCalls.length, 1);
});

test('profile consent persistence failure returns 500 without mutation or generation', async () => {
  const originalProfile = {
    user_id: 'user-a',
    allergies: ['eggs'],
    sensitive_data_consent_at: null,
    privacy_notice_version: null
  };
  const { app, state } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a', name: 'Nombre anterior' }],
    profiles: [{ ...originalProfile }],
    failProfileUpsert: true
  });
  const handler = routeHandler(app, 'post', '/setup/:portal_token');

  const result = await invoke(handler, {
    params: { portal_token: 'token-a' },
    body: validProfile('Ana')
  });

  assert.equal(result.status, 500);
  assert.deepEqual(state.profiles[0], originalProfile);
  assert.equal(state.users[0].name, 'Nombre anterior');
  assert.equal(state.userUpdates.length, 0);
  assert.equal(state.webhookCalls.length, 0);
});

test('explicit setup under the new notice records current consent and then preserves its timestamp', async () => {
  const originalConsentAt = '2026-08-10T15:00:00.000Z';
  const { app, state } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a', name: 'Ana' }],
    profiles: [{
      user_id: 'user-a',
      allergies: ['eggs'],
      sensitive_data_consent_at: originalConsentAt,
      privacy_notice_version: '2026-08-10'
    }],
    programs: [{ id: 'program-a', user_id: 'user-a' }]
  });
  const handler = routeHandler(app, 'post', '/setup/:portal_token');

  const firstRepeat = await invoke(handler, {
    params: { portal_token: 'token-a' },
    body: validProfile('Ana actualizada')
  });
  const secondRepeat = await invoke(handler, {
    params: { portal_token: 'token-a' },
    body: validProfile('Ana final')
  });

  assert.equal(firstRepeat.status, 302);
  assert.equal(secondRepeat.status, 302);
  assert.equal(state.profiles.length, 1);
  assert.notEqual(state.profileUpserts[0].sensitive_data_consent_at, originalConsentAt);
  assert.equal(state.profileUpserts[0].privacy_notice_version, '2026-08-11');
  assert.equal(
    state.profileUpserts[1].sensitive_data_consent_at,
    state.profileUpserts[0].sensitive_data_consent_at
  );
  assert.equal(state.profiles[0].sensitive_data_consent_at, state.profileUpserts[0].sensitive_data_consent_at);
  assert.equal(state.profiles[0].privacy_notice_version, '2026-08-11');
  assert.equal(state.profileUpserts.length, 2);
  assert.equal(state.webhookCalls.length, 0);
});

test('setup trims and saves users.name while preserving profile persistence', async () => {
  process.env.PROGRAM_GENERATION_WEBHOOK_URL = 'https://example.test/generate';
  const { app, state } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a', name: null }]
  });
  const handler = routeHandler(app, 'post', '/setup/:portal_token');

  const result = await invoke(handler, {
    params: { portal_token: 'token-a' },
    body: validProfile('  Ana María  ')
  });

  assert.equal(result.status, 302);
  assert.equal(result.location, '/p/token-a');
  assert.equal(state.users[0].name, 'Ana María');
  assert.equal(state.profileUpserts.length, 1);
  assert.equal(state.profileUpserts[0].user_id, 'user-a');
  assert.equal(state.profileUpserts[0].height_cm, 165);
  assert.equal(Object.hasOwn(state.profileUpserts[0], 'name'), false);
  assert.deepEqual(state.webhookCalls, [{
    url: 'https://example.test/generate',
    body: { id: 'user-a' }
  }]);
});

test('setup rejects an empty normalized name before persistence or generation', async () => {
  const { app, state } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a', name: null }]
  });
  const handler = routeHandler(app, 'post', '/setup/:portal_token');

  const result = await invoke(handler, {
    params: { portal_token: 'token-a' },
    body: validProfile('   ')
  });

  assert.equal(result.status, 400);
  assert.equal(state.profileUpserts.length, 0);
  assert.equal(state.userUpdates.length, 0);
  assert.equal(state.webhookCalls.length, 0);
});

test('a name persistence failure returns 500 and does not trigger generation', async () => {
  const { app, state } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a', name: null }],
    failNameUpdate: true
  });
  const handler = routeHandler(app, 'post', '/setup/:portal_token');

  const result = await invoke(handler, {
    params: { portal_token: 'token-a' },
    body: validProfile('Ana')
  });

  assert.equal(result.status, 500);
  assert.equal(state.webhookCalls.length, 0);
});

test('setup view receives and pre-fills the canonical existing user name', async () => {
  const { app } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a', name: 'Ana' }]
  });
  const handler = routeHandler(app, 'get', '/setup/:portal_token');
  const result = await invoke(handler, { params: { portal_token: 'token-a' } });

  const html = await ejs.renderFile(
    path.resolve(__dirname, '../views/setup.ejs'),
    result.data
  );
  assert.match(html, /name="name"/);
  assert.match(html, /value="Ana"/);
  assert.match(html, /name="name"[\s\S]*?required/);
});

test('program status requires a valid X-Portal-Token', async () => {
  const { app } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a' }]
  });
  const handler = routeHandler(app, 'get', '/api/program-status');

  const missing = await invoke(handler);
  const invalid = await invoke(handler, {
    headers: { 'x-portal-token': 'invalid' }
  });

  assert.equal(missing.status, 401);
  assert.deepEqual(missing.body, { ready: false });
  assert.equal(invalid.status, 401);
  assert.deepEqual(invalid.body, { ready: false });
});

test('program status stays false until latest personalization Week 1 is planned with its meal plan', async () => {
  const { app, state } = loadApp({
    users: [{ id: 'user-a', portal_token: 'token-a' }]
  });
  const handler = routeHandler(app, 'get', '/api/program-status');
  const request = { headers: { 'x-portal-token': 'token-a' } };

  assert.deepEqual((await invoke(handler, request)).body, { ready: false });

  state.programs.push({
    id: 'program-a', user_id: 'user-a', status: 'personalization', created_at: '2026-08-07'
  });
  state.weeks.push({
    id: 'week-a', program_id: 'program-a', week_number: 1, status: 'pending'
  });
  assert.deepEqual((await invoke(handler, request)).body, { ready: false });

  state.weeks[0].status = 'planned';
  assert.deepEqual((await invoke(handler, request)).body, { ready: false });

  state.meal_plans.push({
    id: 'plan-a', user_id: 'user-a', program_id: 'program-a', week_id: 'week-a'
  });
  assert.deepEqual((await invoke(handler, request)).body, { ready: true });
});

test('program status cannot become ready from another users program, week, or meal plan', async () => {
  const { app } = loadApp({
    users: [
      { id: 'user-a', portal_token: 'token-a' },
      { id: 'user-b', portal_token: 'token-b' }
    ],
    programs: [
      { id: 'program-b', user_id: 'user-b', status: 'personalization', created_at: '2026-08-07' }
    ],
    weeks: [
      { id: 'week-b', program_id: 'program-b', week_number: 1, status: 'planned' }
    ],
    meal_plans: [
      { id: 'plan-b', user_id: 'user-b', program_id: 'program-b', week_id: 'week-b' }
    ]
  });
  const handler = routeHandler(app, 'get', '/api/program-status');

  const result = await invoke(handler, {
    headers: { 'x-portal-token': 'token-a' }
  });

  assert.deepEqual(result.body, { ready: false });
});

test('preparation view enables one bounded authenticated polling loop only in preparation state', async () => {
  const planView = path.resolve(__dirname, '../views/plan.ejs');
  const preparationHtml = await ejs.renderFile(planView, {
    plan: null,
    user: { portal_token: 'token-a' },
    portalState: {
      title: 'Estamos preparando tu programa personalizado',
      messages: ['Tarda solo unos minutos.'],
      pollProgramStatus: true
    }
  });
  const normalHtml = await ejs.renderFile(planView, {
    plan: null,
    user: { portal_token: 'token-a' },
    portalState: {
      title: 'Aún no tienes un programa',
      messages: ['Cuando tengas un programa, podrás consultar tu plan aquí.']
    }
  });

  assert.match(preparationHtml, /Estamos preparando tu programa personalizado/);
  assert.match(preparationHtml, /fetch\('\/api\/program-status'/);
  assert.match(preparationHtml, /'X-Portal-Token': portalToken/);
  assert.match(preparationHtml, /const pollIntervalMs = 4000/);
  assert.match(preparationHtml, /const maxPollingDurationMs = 180000/);
  assert.match(preparationHtml, /window\.__dietavityProgramStatusPolling/);
  assert.match(preparationHtml, /window\.location\.reload\(\)/);
  assert.match(preparationHtml, /catch \{/);
  assert.doesNotMatch(normalHtml, /fetch\('\/api\/program-status'/);
});

function createPollingHarness(html, fetchImplementation) {
  const script = html.match(/<script>\s*(\(\(\) => \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
  const timers = new Map();
  const timeoutMessage = { hidden: true };
  let nextTimerId = 1;
  let now = 0;
  let reloads = 0;

  const window = {
    location: { reload() { reloads += 1; } },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };

  const context = {
    window,
    document: {
      getElementById(id) {
        return id === 'program-status-timeout' ? timeoutMessage : null;
      }
    },
    fetch: fetchImplementation,
    AbortController: class {
      constructor() { this.signal = {}; }
      abort() {}
    },
    Date: { now: () => now }
  };

  const runScript = () => vm.runInNewContext(script, context);
  const runNextTimer = async () => {
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) return false;
    const [id, timer] = next;
    timers.delete(id);
    now = timer.at;
    await timer.callback();
    return true;
  };

  return {
    runScript,
    runNextTimer,
    timers,
    timeoutMessage,
    get reloads() { return reloads; }
  };
}

test('polling survives a temporary failure and reloads once readiness becomes true', async () => {
  const html = await ejs.renderFile(
    path.resolve(__dirname, '../views/plan.ejs'),
    {
      plan: null,
      user: { portal_token: 'token-a' },
      portalState: {
        title: 'Estamos preparando tu programa personalizado',
        messages: ['Tarda solo unos minutos.'],
        pollProgramStatus: true
      }
    }
  );
  const responses = [
    new Error('temporary network error'),
    { ready: false },
    { ready: true }
  ];
  let requests = 0;
  const harness = createPollingHarness(html, async (url, options) => {
    assert.equal(url, '/api/program-status');
    assert.equal(options.headers['X-Portal-Token'], 'token-a');
    const response = responses[requests++];
    if (response instanceof Error) throw response;
    return { ok: true, async json() { return response; } };
  });

  harness.runScript();
  harness.runScript();
  assert.equal(harness.timers.size, 1);

  await harness.runNextTimer();
  assert.equal(harness.reloads, 0);
  await harness.runNextTimer();
  assert.equal(harness.reloads, 0);
  await harness.runNextTimer();

  assert.equal(requests, 3);
  assert.equal(harness.reloads, 1);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.timeoutMessage.hidden, true);
});

test('polling stops at three minutes without reloading or showing a technical error', async () => {
  const html = await ejs.renderFile(
    path.resolve(__dirname, '../views/plan.ejs'),
    {
      plan: null,
      user: { portal_token: 'token-a' },
      portalState: {
        title: 'Estamos preparando tu programa personalizado',
        messages: ['Tarda solo unos minutos.'],
        pollProgramStatus: true
      }
    }
  );
  let requests = 0;
  const harness = createPollingHarness(html, async () => {
    requests += 1;
    return { ok: false, async json() { return {}; } };
  });

  harness.runScript();
  while (await harness.runNextTimer()) {}

  assert.equal(requests, 45);
  assert.equal(harness.reloads, 0);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.timeoutMessage.hidden, false);
});
