const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const { loadWorkflow } = require('../test-support/workflow-fixture');

const serverPath = require.resolve('../server');
const supabasePath = require.resolve('../lib/supabase');
const planView = path.resolve(__dirname, '../views/plan.ejs');

function loadPortalApp(state) {
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.sort = null;
      this.rowLimit = null;
    }

    select() { return this; }
    eq(field, value) { this.filters.push([field, value]); return this; }
    is(field, value) { this.filters.push([field, value]); return this; }
    order(field, options = {}) {
      this.sort = [field, options.ascending !== false];
      return this;
    }
    limit(value) { this.rowLimit = value; return this; }

    rows() {
      let rows = (state[this.table] || []).filter(row =>
        this.filters.every(([field, value]) => row[field] === value)
      );
      if (this.sort) {
        const [field, ascending] = this.sort;
        rows = [...rows].sort((left, right) =>
          String(left[field]).localeCompare(String(right[field])) * (ascending ? 1 : -1)
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
      return { data: this.rows()[0] || null, error: null };
    }
  }

  const supabase = { from(table) { return new Query(table); } };
  delete require.cache[serverPath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: supabase
  };
  return require(serverPath);
}

function portalHandler(app) {
  return app.router.stack.find(layer => layer.route?.path === '/p/:token')
    .route.stack[0].handle;
}

async function renderPortal(state) {
  const app = loadPortalApp(state);
  const result = {};
  const response = {
    status(code) { result.status = code; return response; },
    send(body) { result.body = body; return response; },
    render(view, data) { result.view = view; result.data = data; return response; }
  };
  await portalHandler(app)({ params: { token: 'portal-token' } }, response);
  result.html = await ejs.renderFile(planView, result.data);
  return result;
}

function calendarDate(timeZone = 'America/Mexico_City') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function planState({ status = 'personalization', startDate = null } = {}) {
  const meal = title => ({
    title,
    description: 'Descripción',
    calories: 300,
    recipe: { ingredients: ['Ingrediente'], steps: ['Paso'] },
    alternatives: [{ title: `Alternativa de ${title}` }]
  });
  return {
    users: [{
      id: 'user-a', portal_token: 'portal-token', name: 'Ana',
      timezone: 'America/Mexico_City'
    }],
    programs: [{
      id: 'program-a', user_id: 'user-a', status, start_date: startDate,
      created_at: '2026-08-08T00:00:00Z'
    }],
    weeks: [{
      id: 'week-a', program_id: 'program-a', week_number: 1,
      status: status === 'active' ? 'active' : 'planned'
    }],
    meal_plans: [{
      id: 'plan-a', user_id: 'user-a', program_id: 'program-a', week_id: 'week-a',
      meals: {
        days: [{
          day: 1,
          meals: {
            breakfast: meal('Desayuno de prueba'),
            lunch: meal('Comida de prueba'),
            dinner: meal('Cena de prueba'),
            snack: meal('Snack de prueba'),
            snacks: ['Snack de prueba']
          }
        }]
      }
    }]
  };
}

test('program initialization links only the deterministic eligible purchase atomically', () => {
  const workflow = loadWorkflow();
  const node = workflow.nodes.find(item => item.name === 'Initialize 28-Day Program');
  const sql = node.parameters.query;

  assert.match(sql, /JOIN created_program program\s+ON program\.user_id = purchase\.user_id/);
  assert.match(sql, /purchase\.purchase_type = '28_day_program'/);
  assert.match(sql, /purchase\.payment_status = 'paid'/);
  assert.match(sql, /purchase\.program_id IS NULL/);
  assert.match(sql, /purchase\.purchased_at DESC NULLS LAST,\s+purchase\.created_at DESC,\s+purchase\.id DESC/);
  assert.match(sql, /FOR UPDATE OF purchase/);
  assert.match(sql, /SET program_id = program\.id/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM linked_purchase\) AS purchase_linked/);
  assert.match(node.notes, /roll back together for a safe retry/);
});

test('unscheduled preparation keeps review hierarchy, controls, and prepared meals', async () => {
  const result = await renderPortal(planState());

  assert.equal(result.data.isScheduledPreparation, false);
  assert.match(result.html, /Prepara tu primera semana/);
  assert.match(result.html, /Revisa tu semana/);
  assert.match(result.html, /¿Cuándo quieres comenzar\?/);
  assert.match(result.html, /Desayuno de prueba/);
  assert.match(result.html, /Lista del súper/);
  assert.match(result.html, /Ver receta/);
  assert.match(result.html, /No me gustó/);
});

test('future scheduled preparation promotes one ready message and keeps plan tools', async () => {
  const tomorrow = addDays(calendarDate(), 1);
  const result = await renderPortal(planState({ startDate: tomorrow }));

  assert.equal(result.data.isScheduledPreparation, true);
  assert.equal((result.html.match(/Tu programa está listo/g) || []).length, 1);
  assert.match(result.html, new RegExp(result.data.selectedStartDateLabel));
  assert.doesNotMatch(result.html, /Prepara tu primera semana/);
  assert.doesNotMatch(result.html, /Revisa tu semana/);
  assert.doesNotMatch(result.html, /¿Cuándo quieres comenzar\?/);
  assert.match(result.html, /Desayuno de prueba/);
  assert.match(result.html, /Lista del súper/);
  assert.match(result.html, /Ver receta/);
  assert.match(result.html, /No me gustó/);
});

test('start date today remains in the existing preparation rendering until activation', async () => {
  const result = await renderPortal(planState({ startDate: calendarDate() }));

  assert.equal(result.data.isScheduledPreparation, false);
  assert.match(result.html, /Prepara tu primera semana/);
  assert.match(result.html, /Revisa tu semana/);
  assert.equal((result.html.match(/Tu programa está listo/g) || []).length, 1);
});

test('active and completed portal rendering remain on their existing branches', async () => {
  const active = await renderPortal(planState({
    status: 'active', startDate: calendarDate()
  }));
  assert.equal(active.data.isPreparation, false);
  assert.match(active.html, /Programa de 28 días/);
  assert.match(active.html, /Día 1 de 28/);
  assert.doesNotMatch(active.html, /Prepara tu primera semana/);

  const completedState = planState({ status: 'completed' });
  const completed = await renderPortal(completedState);
  assert.equal(completed.data.plan, null);
  assert.match(completed.html, /Has completado tu programa de 28 días/);
});

test('existing portal token selects the new successor over a completed historical program', async () => {
  const state = planState();
  state.programs.unshift({
    id: 'completed-program', user_id: 'user-a', status: 'completed',
    start_date: '2026-06-01', created_at: '2026-05-30T00:00:00Z'
  });
  const before = structuredClone(state);
  const result = await renderPortal(state);
  assert.equal(result.data.isPreparation, true);
  assert.match(result.html, /Desayuno de prueba/);
  assert.match(result.html, /¿Cuándo quieres comenzar\?/);
  for (const table of ['users', 'programs', 'weeks']) assert.deepEqual(state[table], before[table]);
});
