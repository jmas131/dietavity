'use strict';

// V4 commercial authority is intentionally small. It is not a culinary
// capability catalogue: recipes, preparation, substitutions, restaurant
// guidance, and ordinary non-clinical food guidance are native assistance.
// This snapshot reflects the current WhatsApp-first validation offer only.
const VERSION = 'dietavity-v4-commercial-authority-2026-10-24';

const SNAPSHOT = Object.freeze({
  version: VERSION,
  identity: Object.freeze({
    service: 'Dietavity is an AI-assisted food and nutrition-support service for people who use GLP-1 medication.',
    channel: 'Dietavity is currently used through WhatsApp; there is no current customer portal.',
    human_service: 'Dietavity does not represent that a human nutritionist individually creates each response or provides clinical care.',
  }),
  offer: Object.freeze({
    current: 'Dietavity is in WhatsApp-first market validation.',
    trial: 'The current trial is one week free and is initially operated manually.',
    paid_offer: 'No paid price, payment method, subscription, renewal, portal, or programme offer is currently available to promise.',
    guarantees: 'No outcome guarantee or public refund policy is confirmed.',
  }),
  medication_boundary: Object.freeze({
    glp1_sale: false,
    glp1_delivery: false,
    glp1_prescription: false,
  }),
});

function promptText() {
  return Object.freeze([
    `Authority version: ${SNAPSHOT.version}.`,
    'The following statements are the only authority for claims about Dietavity as a commercial service:',
    `- ${SNAPSHOT.identity.service}`,
    `- ${SNAPSHOT.identity.channel}`,
    `- ${SNAPSHOT.identity.human_service}`,
    `- ${SNAPSHOT.offer.current}`,
    `- ${SNAPSHOT.offer.trial}`,
    `- ${SNAPSHOT.offer.paid_offer}`,
    `- ${SNAPSHOT.offer.guarantees}`,
    '- Dietavity does not sell, deliver, or prescribe GLP-1 medication.',
    'Do not treat this commercial authority as a list of culinary capabilities. You may provide ordinary recipes, preparation instructions, substitutions, restaurant/order guidance, food recommendations, and non-clinical nutrition guidance without claiming they are separately purchased product features.',
  ].join('\n'));
}

module.exports = Object.freeze({ VERSION, SNAPSHOT, promptText });
