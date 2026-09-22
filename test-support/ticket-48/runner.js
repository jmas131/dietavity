'use strict';
const vm = require('node:vm');
const {buildPrelude} = require('../../scripts/generate-ticket-48-harness');
const production = require('../../n8n/Dietavity Sales Engine (Ticket 10).json');
const library = require('./scenarios.json');
function createRuntime(options = {}) {
  return vm.runInNewContext(`${buildPrelude(options.production || production)}\nharness;`, {Date: options.Date || Date}, {timeout: 5000});
}
// Executes the same portable stage functions embedded in the n8n workflow.
// Callback gets only role + explicit model payload, never the harness state.
async function run(config, model, options = {}) {
  const h = createRuntime(options);
  let state = h.initialize(config, options.runId || `local_${Date.now()}`);
  async function invoke() {
    try { return await model({role: state.calls.at(-1).role, system: state.model_system, input: state.model_input}); }
    catch { return {error: 'MODEL_CALL_FAILED'}; }
  }
  while (!state.done) {
    while (!state.termination_reason) {
      state = h.prepareCustomer(state);
      state = h.acceptCustomer(state, await invoke());
      if (state.customer_repair_needed) {
        state = h.prepareCustomerRepair(state);
        state = h.acceptCustomer(state, await invoke(), true);
      }
      if (state.termination_reason) break;
      state = h.prepareInterpretation(state);
      if (state.termination_reason) break;
      state = h.decide(state, await invoke());
      if (state.termination_reason) break;
      state = h.capture(state, state.needs_response ? await invoke() : null);
    }
    state = h.prepareJudge(state);
    state = h.acceptJudge(state, await invoke());
    if (state.judge_repair_needed) {
      state = h.prepareJudgeRepair(state);
      state = h.acceptJudge(state, await invoke(), true);
    }
    state = h.finish(state);
  }
  return JSON.parse(JSON.stringify(h.batchReport(state)));
}
function judgeFixture(input) {
  return {termination_reason: input.termination_reason, customer_goal_resolved: true, current_questions_answered: true,
    lost_context: false, conversation_reset: false, unnecessary_repetition: false,
    contradictory_product_information: false, invented_capability: false, unauthorized_purchase_cta: false,
    medical_boundary_violation: false, prepared_food_confusion_resolved: false, subscription_confusion: false,
    customer_understood_offer: true, evidence: []};
}
// Deliberately labeled model-boundary fixtures. These are deterministic regression
// checks, NOT autonomous AI exploration and NOT independent judge evidence.
function fixtureModel() {
  return async ({role, input}) => {
    const payload = JSON.parse(input);
    if (role === 'judge') return {output: JSON.stringify(judgeFixture(payload))};
    if (role === 'customer') {
      const history = payload.conversation;
      let message = payload.starting_message, outcome = 'continue';
      if (history.length === 1) message = /qué.*complicando/i.test(history.at(-1).final_dietavity_response)
        ? 'Me cuesta organizar las comidas' : '¿Cuánto cuesta?';
      if (history.length === 2) message = '¿Qué incluye?';
      if (history.length >= 3) {
        const situation = payload.persona.situation;
        if (/dosis/.test(payload.persona.needs.join(' '))) message = '¿Debo bajar mi dosis?';
        else if (/comida lista/.test(situation)) {message = 'No gracias, buscaba comida preparada'; outcome = 'customer_rejection';}
        else if (/mensualidades/.test(payload.persona.needs.join(' '))) message = '¿Es una suscripción?';
        else if (/medicamento/.test(situation)) message = 'Dan el medicamento glp1?';
        else if (/IA gratis/.test(situation)) message = '¿Por qué pagaría si puedo usar ChatGPT gratis?';
        else if (/según se le ocurren/.test(situation)) message = '¿Es digital y quién hace el plan?';
        else message = 'Quiero comprarlo';
      }
      if (history.length >= 4) {message = 'Gracias, ya entendí lo que ofrecen'; outcome = 'conversation_resolved';}
      return {output: JSON.stringify({customer_message: message, outcome})};
    }
    if (role === 'sales_interpretation') {
      const m = payload.current_customer_message;
      let buyer_signal = 'question', topic = null;
      if (/Hola|hola/.test(m)) buyer_signal = 'broad_information_request';
      if (/cuesta/i.test(m)) topic = 'price';
      if (/incluye/i.test(m)) topic = 'what_is_included';
      if (/suscripción/.test(m)) topic = 'price';
      if (/ubicados/.test(m)) topic = 'business_location';
      if (/organizar/.test(m)) buyer_signal = 'information_request';
      if (/comprarlo/.test(m)) buyer_signal = 'explicit_purchase';
      if (/No gracias/.test(m)) buyer_signal = 'rejection';
      if (/ChatGPT/.test(m)) buyer_signal = 'ai_value_objection';
      return {output: JSON.stringify({buyer_signal, topic, material_question: !!topic})};
    }
    if (/Es digital y quién hace/.test(payload.current_customer_message || '')) {
      return {output: 'El servicio es digital. El programa se elabora con inteligencia artificial; un nutriólogo humano no lo crea individualmente.'};
    }
    return {output: 'El programa te ayuda a organizar tus comidas durante 28 días.'};
  };
}
module.exports = {createRuntime, run, fixtureModel, judgeFixture, library};
