const test = require('node:test');
const assert = require('node:assert/strict');

const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const axiosPath = require.resolve('axios');

const users = [
  { id: 'user-a', portal_token: 'token-a' },
  { id: 'user-b', portal_token: 'token-b' }
];

function createPlan(id, userId) {
  return {
    id,
    user_id: userId,
    week_id: `week-${userId}`,
    program_id: `program-${userId}`,
    updated_at: '2026-08-07T00:00:00.000Z',
    meals: {
      days: [{
        meals: {
          desayuno: {
            name: 'Desayuno original',
            recipe: { ingredients: [], steps: [] }
          }
        }
      }]
    }
  };
}

function loadApp() {
  const state = {
    plans: [
      createPlan('plan-a', 'user-a'),
      createPlan('plan-b', 'user-b')
    ],
    profiles: [
      {
        user_id: 'user-a',
        eating_style: 'vegetarian',
        allergies: ['nuez'],
        foods_to_avoid: ['hongos'],
        medical_conditions: ['hypertension']
      },
      {
        user_id: 'user-b',
        eating_style: null,
        allergies: [],
        foods_to_avoid: [],
        medical_conditions: []
      }
    ],
    profileReadError: null,
    profileSelects: [],
    webhookCalls: 0,
    webhookPayloads: [],
    updateAttempts: 0,
    forceConcurrentUpdate: false
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.updateValues = null;
    }

    select(fields) {
      if (this.table === 'profiles') state.profileSelects.push(fields);
      return this;
    }

    eq(field, value) {
      this.filters.push([field, value]);
      return this;
    }

    update(values) {
      this.updateValues = values;
      return this;
    }

    maybeSingle() {
      if (this.table === 'profiles' && state.profileReadError) {
        return Promise.resolve({ data: null, error: state.profileReadError });
      }

      const rows = this.table === 'users'
        ? users
        : this.table === 'profiles'
          ? state.profiles
          : state.plans;
      const match = rows.find(row =>
        this.filters.every(([field, value]) => row[field] === value)
      );

      if (!this.updateValues) {
        return Promise.resolve({ data: match || null, error: null });
      }

      state.updateAttempts += 1;

      if (state.forceConcurrentUpdate && state.updateAttempts === 1) {
        const plan = state.plans.find(row => row.id === 'plan-a');
        plan.updated_at = '2026-08-07T00:01:00.000Z';
        return Promise.resolve({ data: null, error: null });
      }

      if (!match) {
        return Promise.resolve({ data: null, error: null });
      }

      Object.assign(match, this.updateValues);
      return Promise.resolve({ data: { id: match.id }, error: null });
    }
  }

  const supabase = {
    from(table) {
      return new Query(table);
    }
  };

  const axios = {
    async post(url, payload) {
      state.webhookCalls += 1;
      state.webhookPayloads.push(payload);
      return {
        data: {
          meal: {
            name: 'Desayuno regenerado',
            recipe: { ingredients: [], steps: [] }
          }
        }
      };
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

function routeHandler(app, method, path) {
  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === path && candidate.route.methods[method]
  );
  return layer.route.stack[0].handle;
}

async function invoke(handler, { headers = {}, params = {}, query = {}, body = {} }) {
  const result = {};
  const response = {
    status(code) { result.status = code; return response; },
    json(payload) {
      result.status ||= 200;
      result.body = payload;
      return response;
    }
  };

  await handler({ headers, params, query, body }, response);
  return result;
}

test('shopping list requires a valid portal token and hides other users plans', async () => {
  const { app } = loadApp();
  const handler = routeHandler(app, 'get', '/api/shopping-list/:planId');

  const missing = await invoke(handler, { params: { planId: 'plan-a' } });
  assert.equal(missing.status, 401);

  const invalid = await invoke(handler, {
    headers: { 'x-portal-token': 'invalid' },
    params: { planId: 'plan-a' }
  });
  assert.equal(invalid.status, 401);

  const inaccessible = await invoke(handler, {
    headers: { 'x-portal-token': 'token-a' },
    params: { planId: 'plan-b' }
  });
  assert.equal(inaccessible.status, 404);

  const nonexistent = await invoke(handler, {
    headers: { 'x-portal-token': 'token-a' },
    params: { planId: 'missing' }
  });
  assert.equal(nonexistent.status, 404);
  assert.deepEqual(nonexistent.body, inaccessible.body);

  const ownPlan = await invoke(handler, {
    headers: { 'x-portal-token': '  token-a  ' },
    params: { planId: 'plan-a' },
    query: { weekId: 'week-user-a', programId: 'program-user-a' }
  });
  assert.equal(ownPlan.status, 200);
  assert.equal(ownPlan.body.success, true);
});

test('unauthorized regeneration does not call the webhook or mutate a plan', async () => {
  const { app, state } = loadApp();
  const handler = routeHandler(app, 'post', '/api/regenerate-meal');
  const body = {
    planId: 'plan-a',
    weekId: 'week-user-a',
    programId: 'program-user-a',
    dayIndex: 0,
    mealType: 'desayuno'
  };

  const missing = await invoke(handler, { body });
  assert.equal(missing.status, 401);

  const invalid = await invoke(handler, {
    headers: { 'x-portal-token': 'invalid' },
    body
  });
  assert.equal(invalid.status, 401);

  const inaccessible = await invoke(handler, {
    headers: { 'x-portal-token': 'token-b' },
    body
  });
  assert.equal(inaccessible.status, 404);

  const nonexistent = await invoke(handler, {
    headers: { 'x-portal-token': 'token-a' },
    body: { ...body, planId: 'missing' }
  });
  assert.equal(nonexistent.status, 404);
  assert.deepEqual(nonexistent.body, inaccessible.body);

  assert.equal(state.webhookCalls, 0);
  assert.equal(state.updateAttempts, 0);
  assert.equal(
    state.plans[0].meals.days[0].meals.desayuno.name,
    'Desayuno original'
  );
});

test('authorized regeneration preserves optimistic concurrency retry behavior', async () => {
  const { app, state } = loadApp();
  state.forceConcurrentUpdate = true;
  const handler = routeHandler(app, 'post', '/api/regenerate-meal');

  const result = await invoke(handler, {
    headers: { 'x-portal-token': 'token-a' },
    body: {
      planId: 'plan-a',
      weekId: 'week-user-a',
      programId: 'program-user-a',
      dayIndex: 0,
      mealType: 'desayuno'
    }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.meal.name, 'Desayuno regenerado');
  assert.equal(state.webhookCalls, 1);
  assert.equal(state.updateAttempts, 2);
  assert.equal(
    state.plans[0].meals.days[0].meals.desayuno.name,
    'Desayuno regenerado'
  );
});

test('regeneration sends only normalized canonical profile restrictions and ignores browser spoofing', async () => {
  const { app, state } = loadApp();
  const handler = routeHandler(app, 'post', '/api/regenerate-meal');

  state.profiles[0] = {
    ...state.profiles[0],
    eating_style: ' vegetarian ',
    allergies: [' nuez '],
    foods_to_avoid: [' hongos '],
    medical_conditions: [' hypertension '],
    birth_year: 1980,
    height_cm: 170,
    notes: 'private'
  };

  const result = await invoke(handler, {
    headers: { 'x-portal-token': 'token-a' },
    body: {
      planId: 'plan-a',
      weekId: 'week-user-a',
      programId: 'program-user-a',
      dayIndex: 0,
      mealType: 'desayuno',
      profile: {
        eating_style: 'omnivore',
        allergies: [],
        foods_to_avoid: [],
        medical_conditions: []
      }
    }
  });

  assert.equal(result.status, 200);
  assert.equal(state.webhookCalls, 1);
  assert.deepEqual(state.webhookPayloads[0].profile, {
    eating_style: 'vegetarian',
    allergies: ['nuez'],
    foods_to_avoid: ['hongos'],
    medical_conditions: ['hypertension']
  });
  assert.deepEqual(Object.keys(state.webhookPayloads[0]).sort(), [
    'currentMeal',
    'mealType',
    'profile'
  ]);
  assert.equal(
    state.profileSelects[0],
    'eating_style, allergies, foods_to_avoid, medical_conditions'
  );
  assert.equal('birth_year' in state.webhookPayloads[0].profile, false);
  assert.equal('height_cm' in state.webhookPayloads[0].profile, false);
  assert.equal('notes' in state.webhookPayloads[0].profile, false);
});

test('regeneration normalizes absent canonical restrictions safely', async () => {
  const { app, state } = loadApp();
  const handler = routeHandler(app, 'post', '/api/regenerate-meal');
  state.profiles[0] = { user_id: 'user-a' };

  const result = await invoke(handler, {
    headers: { 'x-portal-token': 'token-a' },
    body: {
      planId: 'plan-a',
      dayIndex: 0,
      mealType: 'desayuno'
    }
  });

  assert.equal(result.status, 200);
  assert.deepEqual(state.webhookPayloads[0].profile, {
    eating_style: null,
    allergies: [],
    foods_to_avoid: [],
    medical_conditions: []
  });
});

test('profile query failures stop regeneration before webhook and persistence', async () => {
  const { app, state } = loadApp();
  const handler = routeHandler(app, 'post', '/api/regenerate-meal');
  state.profileReadError = new Error('profile database unavailable');

  const result = await invoke(handler, {
    headers: { 'x-portal-token': 'token-a' },
    body: {
      planId: 'plan-a',
      dayIndex: 0,
      mealType: 'desayuno'
    }
  });

  assert.equal(result.status, 500);
  assert.equal(state.webhookCalls, 0);
  assert.equal(state.updateAttempts, 0);
  assert.equal(
    state.plans[0].meals.days[0].meals.desayuno.name,
    'Desayuno original'
  );
});

test('missing canonical profile fails closed before webhook and persistence', async () => {
  const { app, state } = loadApp();
  const handler = routeHandler(app, 'post', '/api/regenerate-meal');
  state.profiles = state.profiles.filter(profile => profile.user_id !== 'user-a');

  const result = await invoke(handler, {
    headers: { 'x-portal-token': 'token-a' },
    body: {
      planId: 'plan-a',
      dayIndex: 0,
      mealType: 'desayuno'
    }
  });

  assert.equal(result.status, 409);
  assert.equal(state.webhookCalls, 0);
  assert.equal(state.updateAttempts, 0);
});
