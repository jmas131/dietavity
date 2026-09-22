'use strict';
module.exports = [
  {id:'A', topic:'business_location', messages:[
    '¿Es en línea o presencial? ¿Quién crea el plan y cómo lo personalizan? ¿Hay prueba o promoción?',
    'Quisiera saber si tengo que ir a un consultorio, si el menú lo hace una persona o IA, cómo consideran mis alergias y si puedo probarlo gratis.'
  ], draft:'El servicio es digital, por portal y WhatsApp. El programa se arma con inteligencia artificial, no lo elabora individualmente un nutriólogo humano. La personalización considera estilo de alimentación, alergias y alimentos a evitar después del pago. No tengo una prueba o promoción confirmada.', expected:[/digital/i,/inteligencia artificial/i,/alergias/i,/prueba|promoci[oó]n/i]},
  {id:'B', topic:'credentials', messages:[
    '¿Lo hace un nutriólogo humano o IA? ¿Respetan alergias y preferencias? ¿Hay prueba o promoción, qué métodos de pago aceptan, hacen reembolso y qué apoyo dan por WhatsApp?',
    'Quiero aclarar quién diseña el menú, si toman alimentos que evito, si ofrecen descuento, si aceptan OXXO, las devoluciones y la ayuda por WhatsApp.'
  ], draft:'Usamos inteligencia artificial; un nutriólogo humano no elabora cada programa. Se consideran alergias y alimentos a evitar. No tengo promociones confirmadas. Puedes pagar con tarjeta, OXXO o Apple Pay. No tengo una política pública de reembolso aprobada. Por WhatsApp puedes pedir recetas e ideas. Ajustamos las porciones para ti.', expected:[/inteligencia artificial/i,/alergias/i,/promoci[oó]n|descuento/i,/OXXO/,/reembolso/i,/WhatsApp/i]},
  {id:'C', topic:'what_is_included', messages:[
    'Contesta punto por punto: 1) ¿Qué incluye? 2) ¿Quién arma el menú? 3) ¿Cómo lo personalizan para alergias? 4) ¿Hay una prueba?',
    'Ayúdame con estas dudas: qué recibo, lo crea una IA o una persona, consideran alimentos a evitar y puedo probarlo gratis?'
  ], draft:'1) ¿Qué incluye? Incluye desayuno, comida, cena y snack durante 28 días. 2) ¿Quién lo arma? Usamos inteligencia artificial; no lo elabora individualmente un nutriólogo humano. 3) ¿Personalización? Considera estilo de alimentación, alergias y alimentos a evitar. 4) ¿Prueba? No tengo una prueba gratuita o promoción confirmada.', expected:[/desayuno/i,/inteligencia artificial/i,/alergias/i,/prueba|promoci[oó]n/i]},
  {id:'D', topic:'personalization', messages:[
    '¿En qué se basa la personalización? También dime cuánto cuesta, qué pasa con el reembolso y si hay una prueba gratis.',
    '¿Cómo toman mis restricciones? Antes de decidir quisiera aclarar el precio, las devoluciones y alguna promoción.'
  ], draft:'Respetamos tu estilo de alimentación, alergias y alimentos a evitar. Cuesta $149 MXN en un solo pago. Soporte debe confirmar cualquier reembolso; no hay una política pública aprobada para citar. No tengo una prueba o promoción confirmada. Ajustamos las porciones clínicamente.', expected:[/alergias/i,/149 MXN/,/reembolso/i,/prueba|promoci[oó]n/i]}
];
