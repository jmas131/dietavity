'use strict';

// This is routing metadata, not product truth or policy. Unknown subjects are
// deliberately left unmapped and remain source-null bounded unknowns.
const FACT_SUBJECTS = Object.freeze({
  price: { factKey: 'offer.price', offerScoped: true },
  duration: { factKey: 'offer.duration_days', offerScoped: true },
  billing_model: { factKey: 'offer.billing_model', offerScoped: true },
  subscription: { factKey: 'offer.subscription', offerScoped: true },
  automatic_renewal: { factKey: 'offer.automatic_renewal', offerScoped: true },
  meals: { factKey: 'offer.meals', offerScoped: true },
  personalization_after_verified_payment: { factKey: 'offer.personalization_after_verified_payment', offerScoped: true },
  start_date: { factKey: 'offer.start_date_window', offerScoped: true },
  payment_method: { factKey: 'payment.supported_methods', offerScoped: true, membership: 'contains' },
  portal_delivery: { factKey: 'service.portal_delivery', offerScoped: true },
  whatsapp_support: { factKey: 'service.whatsapp_support', offerScoped: true },
  prepared_food_delivery: { factKey: 'service.prepared_food_delivery', offerScoped: true },
  in_person_service: { factKey: 'service.in_person_location', offerScoped: true },
  in_person_location: { factKey: 'service.in_person_location', offerScoped: true },
  medication_sale: { factKey: 'service.glp1_medication_sale', offerScoped: false },
  medication_delivery: { factKey: 'service.glp1_medication_delivery', offerScoped: false },
  medication_prescription: { factKey: 'service.glp1_medication_prescription', offerScoped: false },
  glp1_medication_sale: { factKey: 'service.glp1_medication_sale', offerScoped: false },
  glp1_medication_delivery: { factKey: 'service.glp1_medication_delivery', offerScoped: false },
  glp1_medication_prescription: { factKey: 'service.glp1_medication_prescription', offerScoped: false },
  refund_policy: { factKey: 'offer.public_refund_policy', offerScoped: true },
});

const DEFERRED_STAGES = Object.freeze({
  practical_guidance: 'reviewed_knowledge_or_reasoning',
  conversational_task: 'conversational_generation',
  support_account: 'support_resolution',
  social_acknowledgement: 'response_composition',
});

const POLICY_CATEGORIES = new Set(['medication_management', 'safety_sensitive_nutrition', 'commercial_purchase_intent', 'reminder_request']);
const FACT_CATEGORIES = new Set(['product_fact', 'provider_service_fact']);

module.exports = { DEFERRED_STAGES, FACT_CATEGORIES, FACT_SUBJECTS, POLICY_CATEGORIES };
