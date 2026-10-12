'use strict';

function foodDiagnostics(foodContext) {
  return Object.freeze({
    available_food_ids: [...(foodContext?.available_foods || [])],
    recently_consumed_ids: [...(foodContext?.recently_consumed || [])],
    available_count: (foodContext?.available_foods || []).length,
    recently_consumed_count: (foodContext?.recently_consumed || []).length,
  });
}

function emit(logger, value) {
  if (typeof logger === 'function') logger(Object.freeze(value));
}

module.exports = Object.freeze({ foodDiagnostics, emit });
