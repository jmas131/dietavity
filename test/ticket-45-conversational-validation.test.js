'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const workflow = require('../n8n/Dietavity Sales Engine (Ticket 10).json');
const knowledge = require('../lib/dietavity-knowledge');
function run(name, records, input = {}) {
  return vm.runInNewContext(`(function(){${workflow.nodes.find(n => n.name === name).parameters.jsCode}})()`, {
    $: name => ({item:{json:records[name] || {}}}), $input:{first:()=>({json:input})},
  })[0].json;
}
function turn(message, topic, generated, session = {}) {
  const records = {
    'Set Session Id': {chatInput:message,session_id:'ticket45:test'},
    'If Existing Onboarding Session': {session_id:'ticket45:test'},
    'Get Onboarding Session': session,
    'Parse Sales Interpretation': {interpretation_valid:true,buyer_signal:'question',topic,material_question:true},
  };
  const decision = run('Apply Deterministic Commercial Policy', records);
  const result = run('Validate Sales Response Contract', {...records,'Apply Deterministic Commercial Policy':decision}, {output:generated});
  return {decision,result};
}
const fixtures = [
  ['Cómo arman el plan de alimentación?', 'how_it_works', 'En Dietavity armamos el plan con inteligencia artificial y principios generales de alimentación. Respetamos tu estilo de alimentación, alergias y alimentos a evitar. ¿Quieres ver un ejemplo?'],
  ['Pero con base en qué lo personalizan?', 'personalization', 'Nos basamos en tu estilo de alimentación, alergias y alimentos a evitar. Las condiciones declaradas son contexto de seguridad, sin ofrecer tratamiento médico.'],
  ['es un metodo una dieta?', 'product_scope', 'Es un programa de alimentación personalizado de 28 días: organiza desayuno, comida, cena y snack. Usamos inteligencia artificial; no es tratamiento médico.'],
  ['¿Cómo funciona?', 'how_it_works', 'Después del pago completas tu personalización y consultas el programa en el portal.'],
  ['¿Qué incluye?', 'what_is_included', 'Incluye desayuno, comida, cena y snack durante 28 días, portal y apoyo por WhatsApp.'],
];
test('Ticket 45 preserves relevant conversational generation across campaign and stale purchase state', () => {
  for (const offer_context of [null,'glp1_validation']) for (const last_question_type of [null,'purchase_confirmation','explain_offer']) {
    for (const [message,topic,generated] of fixtures) {
      const {decision,result} = turn(message,topic,generated,{offer_context,last_question_type,conversation_stage:'offer',offer_version:'28d-149-v1'});
      assert.equal(decision.strategy,'answer_question');
      assert.equal(result.output,generated,message);
      assert.equal(result.checkout_authorized,false);
      assert.equal(result.allow_purchase_cta,false);
      assert.equal(result.next_last_question_type,null);
      assert.equal(result.pending_action,'respond');
      assert.ok(!result.events.includes('purchase_intent'));
      assert.ok(!result.holding_page_would_be_sent);
    }
  }
});
test('Ticket 45 removes unsupported sentences and unauthorized action clauses, retaining subject', () => {
  for (const claim of ['Usamos tus horarios y porciones habituales.', 'Te preguntamos cuántas comidas prefieres.', 'Ajustamos calorías clínicas.', 'Te ayudamos a mantener masa muscular.', 'No pedimos detalles médicos sensibles.']) {
    const safe = 'En Dietavity armamos el plan con inteligencia artificial.';
    const {result} = turn(fixtures[0][0],'how_it_works',`${safe} ${claim} ¿Quieres que te envíe el enlace?`);
    assert.equal(result.output,safe);
  }
  for (const cta of ['¿Quieres comenzar tu programa?', 'Compra ahora aquí: https://example.com/pago', 'Te comparto el enlace de pago.', 'https://dietavity.com/programa-glp1']) {
    const {result} = turn('¿Qué incluye?','what_is_included',`Incluye cuatro comidas diarias. ${cta}`);
    assert.equal(result.output,'Incluye cuatro comidas diarias.');
  }
});
test('Ticket 45 invalid answers fall back within the topic without purchase advancement', () => {
  for (const generated of ['', 'Perfecto', '¿Quieres un ejemplo? ¿Quieres comprar?', 'El código interno es 28d-149-v1.', 'Cuesta $99 MXN.']) {
    const {result} = turn(fixtures[1][0],'personalization',generated);
    assert.match(result.output,/estilo de alimentación/);
    assert.doesNotMatch(result.output,/enlace|comprar|28d-149-v1|99/);
    assert.ok((result.output.match(/\?/g)||[]).length <= 1);
  }
});
test('Ticket 45 explicit purchase keeps generic Checkout and GLP-1 holding behavior', () => {
  for (const message of ['Quiero comprarlo','¿Cómo pago?','Mándame el enlace','Sí, quiero contratarlo']) {
    for (const offer_context of [null,'glp1_validation']) {
      const {decision} = turn(message,null,'',{offer_context});
      assert.equal(decision.checkout_authorized,offer_context !== 'glp1_validation',message);
      assert.equal(decision.pending_action,offer_context ? 'respond' : 'send_checkout');
      assert.equal(decision.holding_page_would_be_sent === true,Boolean(offer_context));
      assert.ok(decision.events.includes('purchase_intent'));
    }
  }
});
test('Ticket 45 sequential information remains noncommercial after the canonical opening', () => {
  for (const offer_context of [null,'glp1_validation']) {
    let session = {offer_context,conversation_stage:'new'};
    for (const [message,topic,generated] of [['¡Hola! Quiero saber más.',null,'Hola.'],...fixtures.slice(0,2)]) {
      const {result} = turn(message,topic,generated,session);
      assert.equal(result.checkout_authorized,false);
      assert.doesNotMatch(result.output,/envíe el enlace|programa-glp1|checkout/i);
      session = {...session,conversation_stage:result.conversation_stage,last_question_type:result.next_last_question_type};
    }
  }
});
test('Ticket 45 canonical knowledge distinguishes collected fields from implemented personalization', () => {
  assert.match(knowledge.PERSONALIZATION_FACTS,/mes y año de nacimiento, estatura, peso/);
  assert.match(knowledge.PERSONALIZATION_FACTS,/cuatro categorías canónicas/);
  assert.match(knowledge.PERSONALIZATION_FACTS,/No afirmes que recogemos o usamos objetivos y horarios/);
  assert.match(knowledge.PERSONALIZATION_FACTS,/No prometas mantener masa muscular/);
  const code = workflow.nodes.find(n=>n.name==='Build Canonical Dietavity Knowledge').parameters.jsCode;
  assert.ok(code.includes('Personalización verificada'));
});
test('Ticket 45 new purchase variants exclude negation, hypotheticals and payment-method questions', () => {
  for (const message of ['No quiero contratarlo', 'Si quisiera contratarlo, ¿cómo funciona?', '¿Cómo pago sin tarjeta?', '¿Cómo puedo pagar en OXXO?', 'ok', 'perfecto', 'gracias']) {
    for (const offer_context of [null,'glp1_validation']) {
      const {decision} = turn(message,'how_it_works','',{offer_context,last_question_type:'purchase_confirmation'});
      assert.equal(decision.checkout_authorized,false,message);
      assert.ok(!decision.events.includes('purchase_intent'),message);
      assert.ok(!decision.holding_page_would_be_sent,message);
    }
  }
});
test('Ticket 45 preserved informational generation still enforces medication safety in both contexts', () => {
  for (const offer_context of [null,'glp1_validation']) {
    const {result} = turn(fixtures[0][0],'how_it_works','Armamos el programa para ti. Baja tu dosis a 2 mg.',{offer_context});
    assert.doesNotMatch(result.output,/2 mg|Baja tu dosis/);
    assert.match(result.output,/profesional que te lo prescribió/);
  }
});
test('Ticket 45 preserved answers do not start sensitive pre-purchase personalization', () => {
  const explanation = 'La personalización considera tu estilo de alimentación y alergias después del pago y con tu consentimiento.';
  for (const request of ['¿Cuánto pesas?', '¿Cuál es tu edad?', '¿Tienes alergias?', 'Dime tus medicamentos.', 'Comparte tus restricciones.']) {
    const {result} = turn(fixtures[1][0],'personalization',`${explanation} ${request}`);
    assert.equal(result.output,explanation);
  }
});
