'use strict';

const { assertConversationContext } = require('./conversation-context-validator');
const { SYSTEM_PROMPT, buildInterpreterInput } = require('../../config/sales-engine-v2/interpreter-prompt');
const { InterpreterError, validateModelOutput } = require('./interpreter-validator');

// `model` is intentionally injected. It receives a structured extraction
// request and returns either the JSON object or a JSON string; this module has
// no credentials, SDK, network client, resolver, or side-effect dependency.
async function interpretConversation({ context, model }) {
  let safeContext;
  try { safeContext = assertConversationContext(context); }
  catch (error) { throw new InterpreterError('INTERPRETER_CONTEXT_INVALID', error); }
  if (typeof model !== 'function') throw new InterpreterError('INTERPRETER_MODEL_FAILED');
  let output;
  try {
    output = await model(Object.freeze({ system_prompt: SYSTEM_PROMPT, input: buildInterpreterInput(safeContext) }));
  } catch (error) { throw new InterpreterError('INTERPRETER_MODEL_FAILED', error); }
  return validateModelOutput(output, safeContext.current_message.text);
}

module.exports = { interpretConversation };
