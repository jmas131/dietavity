const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const serverPath = path.resolve(__dirname, '../server.js');
const supabasePath = path.resolve(__dirname, '../lib/supabase.js');

function loadApp({ user, program, rpcError = null }) {
  const calls = [];

  const supabase = {
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() {
          return table === 'users'
            ? { data: user, error: null }
            : { data: program, error: null };
        }
      };
      return query;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: null, error: rpcError };
    }
  };

  delete require.cache[serverPath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: supabase
  };

  return { app: require(serverPath), calls };
}

async function invokeStartRoute(app, token, startDate) {
  const layer = app.router.stack.find(candidate =>
    candidate.route?.path === '/p/:token/start'
  );
  const handler = layer.route.stack[0].handle;
  const result = {};
  const response = {
    status(code) { result.status = code; return response; },
    send(body) { result.body = body; return response; },
    redirect(location) {
      result.status = 302;
      result.location = location;
      return response;
    }
  };

  await handler({ params: { token }, body: { start_date: startDate } }, response);
  return result;
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

test('POST start resolves the token and delegates an allowed date atomically', async () => {
  const user = { id: 'user-1', timezone: 'America/Mexico_City' };
  const program = { id: 'program-1', user_id: user.id };
  const { app, calls } = loadApp({ user, program });

  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: user.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    dateParts.map(part => [part.type, part.value])
  );
  const today = `${values.year}-${values.month}-${values.day}`;
  const selectedDate = addDays(today, 30);
  const response = await invokeStartRoute(app, 'portal-token', selectedDate);

  assert.equal(response.status, 302);
  assert.equal(response.location, '/p/portal-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'start_program_week_one');
  assert.deepEqual(calls[0].args, {
    target_program_id: program.id,
    target_user_id: user.id,
    selected_start_date: selectedDate,
    portal_today: today
  });
});

test('POST start rejects day 31 beyond the canonical window', async () => {
  const user = { id: 'user-1', timezone: 'America/Mexico_City' };
  const program = { id: 'program-1', user_id: user.id };
  const { app, calls } = loadApp({ user, program });
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: user.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  const response = await invokeStartRoute(app, 'portal-token', addDays(today, 31));
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('POST start rejects a date outside the server-calculated window', async () => {
  const user = { id: 'user-1', timezone: 'America/Mexico_City' };
  const program = { id: 'program-1', user_id: user.id };
  const { app, calls } = loadApp({ user, program });

  const response = await invokeStartRoute(app, 'portal-token', '2000-01-01');

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('POST start rejects an unknown portal token', async () => {
  const { app, calls } = loadApp({ user: null, program: null });

  const response = await invokeStartRoute(app, 'unknown', '2026-08-04');

  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
});
