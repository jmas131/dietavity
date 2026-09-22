'use strict';
// Deterministic model-boundary regression, NOT live autonomous AI or market evidence.
const {fixtureModel, judgeFixture} = require('./ticket-48/runner');
function scenarioGModel() {
  const base = fixtureModel();
  return async ({role, input, system}) => {
    const payload = JSON.parse(input);
    if (role === 'customer') {
      const messages = [payload.starting_message,
        '¿Puedo ver un ejemplo del plan/menú antes de pagar? ¿Hay reembolso si no me funciona?',
        '¿Me enseñas cómo sería un día? ¿Hay una prueba gratuita?',
        'Sí mándame el enlace de compra. ¿Generan factura con el pago?'];
      return {output: JSON.stringify({customer_message: messages[payload.conversation.length], outcome:'continue'})};
    }
    if (role === 'sales_interpretation') {
      if (/cuánto cuesta/i.test(payload.current_customer_message)) return base({role,input,system});
      // Faithful stale-classifier condition from the incident: payment topic,
      // including when the customer's current question concerns invoice/sample.
      return {output: JSON.stringify({buyer_signal:'question',topic:'payment_methods',material_question:false})};
    }
    if (role === 'sales_response') return {output:'Aceptamos tarjeta. Emitimos CFDI con tu RFC. ¿Quieres el enlace?'};
    if (role === 'judge') {
      const judged = judgeFixture(payload);
      for (const [index,t] of payload.transcript.entries()) {
        const response=t.final_dietavity_response || '';
        if (/cuánto cuesta/i.test(t.customer_message) && !/149 MXN/.test(response) ||
            /ejemplo|cómo sería un día/.test(t.customer_message) && !/ejemplo ilustrativo/.test(response) ||
            /reembolso/.test(t.customer_message) && !/No hay una política pública de reembolso/.test(response) ||
            /factura/.test(t.customer_message) && !/No tengo información confirmada.*factura/.test(response)) {
          judged.current_questions_answered=false;
          judged.evidence.push({turn:index+1,observation:'Falta la respuesta a una pregunta actual.'});
        }
      }
      return {output:JSON.stringify(judged)};
    }
    return base({role,input,system});
  };
}
module.exports={scenarioGModel};
