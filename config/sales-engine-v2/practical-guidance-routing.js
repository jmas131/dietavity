'use strict';

// Closed routing from structured Interpreter subjects. This never inspects
// customer prose and deliberately leaves unknown subjects unmapped.
const REVIEWED_KNOWLEDGE_ROUTING = Object.freeze({
  food_storage: Object.freeze({ topic: 'food_storage' }),
  meal_preparation: Object.freeze({ topic: 'meal_preparation' }),
});

module.exports = { REVIEWED_KNOWLEDGE_ROUTING };
