'use strict';
// Model-boundary regression only: never represents a live autonomous run.
const {fixtureModel, judgeFixture} = require('./ticket-48/runner');
function scenarioGModel() {
  const base=fixtureModel();
  return async ({role,input,system}) => {
    const payload=JSON.parse(input);
    if(role==='customer') {
      const messages=[payload.starting_message,
        '¿Puedo pagar con tarjeta o solo transferencia? ¿Cuánto tiempo tarda en generarse mi plan después del pago?',
        '¿En cuántas horas suele estar listo el plan después del pago?',
        '¿Tienen soporte por WhatsApp que me avise cuando quede listo?',
        '¿Me avisan cuando esté disponible?'];
      const index=payload.conversation.length;
      return {output:JSON.stringify({customer_message:messages[index],outcome:index===messages.length-1?'conversation_resolved':'continue'})};
    }
    if(role==='sales_interpretation') {
      if(/cuánto cuesta/i.test(payload.current_customer_message)) return base({role,input,system});
      return {output:JSON.stringify({buyer_signal:'deferred_interest',topic:'post_purchase',
        explicit_reminder_request:true,timing_iso:new Date(Date.now()+86400000).toISOString()})};
    }
    if(role==='sales_response') return {output:'Aceptamos tarjeta. Estará listo en unas horas y te avisaremos. ¿Qué día quieres que te lo recuerde?'};
    if(role==='judge') return {output:JSON.stringify(judgeFixture(payload))};
    return base({role,input,system});
  };
}
module.exports={scenarioGModel};
