const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, 'n8n', 'Dietavity live 2.4.3.json');
const backupPath = path.join(root, 'archive', 'Dietavity live 2.4.3 pre-ticket-5.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, `${JSON.stringify(workflow, null, 2)}\n`);
}

const byName = (name) => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Missing workflow node: ${name}`);
  return node;
};

const removeNodes = new Set([
  'Unified Merge',
  'Safeguard',
  'Follow Up Detector',
  'Read Last Assistant Message',
  'Combined Object',
  'If UpdateNeeded Meal Plan',
  'Build Meal Plan Prompt',
  'Meal Plan Chat Completions',
  'Parse JSON Meal Plan',
  'If JSON Error',
  'Error JSON Meal Plan',
  'Portal Token Link',
  'Create Meal Plan',
  'Send Meal Plan Link',
  'Send Error Meal Plan Link',
  'Send Error Notification Meal Plan',
  'Update User Preference Meal Plan',
  'If updateNeeded General',
  'If updateNeeded all Other Intents',
  'Update User Preference all Other Intents',
  'Persist Preference General',
  'Build Preference Update Response',
  'Send Update Preferences Message',
  'If Ask Name',
  'If User Name',
  'Update User Name',
  'Send Ask Name Again',
  'If Ask Diet',
  'Send Ask Diet',
  'Update User Ask Diet',
  'Update User Ask Name',
  'Finalize Onboarding',
]);

const classifier = byName('Detect Intent and Entities');
classifier.parameters.options.systemMessage = `You classify the current WhatsApp request from a known Dietavity customer.

Return only valid JSON with this shape:
{
  "intent": "portal_help",
  "confidence": 0.96,
  "entities": {},
  "profile_statement": null
}

Allowed intents:
- portal_help: finding the portal, program link, current meals, an existing program recipe, current week, or canonical shopping list.
- program_help: how the 28-day program works, start date, current week, duration, next week, replacing a program meal, or requests for another/multi-day plan.
- recipe: an ad-hoc recipe from ingredients, a dish, or a time constraint. A recipe already in the user's program is portal_help.
- meal_idea: one or a few practical meal alternatives outside the fixed program, including when the user cannot follow it today.
- restaurant_near: healthy restaurants near a stated place.
- restaurant_menu: what to choose at a named restaurant or from a menu.
- advice: general healthy-eating or longevity guidance.
- support: Dietavity access, product, payment, or technical help that is not simply asking where the portal is.
- general: greetings, thanks, acknowledgements, unclear requests, and other conversation.
- unsubscribe: a request to cancel a recurring subscription. Classification never authorizes cancellation.

Important mappings:
- "¿Dónde veo mi plan?" and "¿Dónde está mi lista del súper?" -> portal_help.
- "¿Cuándo empieza mi programa?" -> program_help.
- "Hazme otro plan de 7 días" -> program_help, never recipe or meal_idea.
- "Tengo huevo, tomate y tortillas. ¿Qué preparo?" -> recipe.
- "Hoy no puedo seguir el plan. ¿Qué puedo cenar?" -> meal_idea.

Allowed entities are only restaurant, neighborhood, city, region, ingredient, dish, meal_type, and timeframe. Do not extract name, diet, allergy, dislike, condition, cuisine, or duration as persistent profile entities.

If the message states a profile fact without a separate request, set intent to general and set profile_statement to one of: "allergy", "medical_condition", "dislike", "diet", or "name". This marker is conversational safety context only and must never be persisted. Otherwise use null.

Rules:
- Shopping-list requests always mean the canonical portal shopping list (portal_help).
- Never classify a request for a multi-day or replacement plan as permission to generate a plan.
- Use unsubscribe for explicit cancellation language, but do not infer subscription state.
- confidence must be a number from 0 to 1.
- Omit entity keys that were not stated. Do not invent facts.`;

const parser = byName('Parse JSON Intent and Entities');
parser.parameters.jsCode = `let raw = $input.first().json.output || '{}';
const validIntents = ['portal_help', 'program_help', 'recipe', 'meal_idea', 'restaurant_near', 'restaurant_menu', 'advice', 'support', 'general', 'unsubscribe'];
const validEntities = ['restaurant', 'neighborhood', 'city', 'region', 'ingredient', 'dish', 'meal_type', 'timeframe'];
const validProfileStatements = ['allergy', 'medical_condition', 'dislike', 'diet', 'name'];

try {
  const data = JSON.parse(raw);
  const intent = validIntents.includes(data.intent) ? data.intent : 'general';
  const confidence = Number.isFinite(Number(data.confidence))
    ? Math.min(1, Math.max(0, Number(data.confidence)))
    : 0;
  const entities = {};
  if (data.entities && typeof data.entities === 'object' && !Array.isArray(data.entities)) {
    for (const [rawKey, rawValue] of Object.entries(data.entities)) {
      const key = rawKey.toLowerCase().trim();
      if (!validEntities.includes(key)) continue;
      if (typeof rawValue === 'string') entities[key] = rawValue.trim();
      else if (Array.isArray(rawValue)) entities[key] = rawValue.filter((value) => typeof value === 'string').map((value) => value.trim());
    }
  }
  const profile_statement = validProfileStatements.includes(data.profile_statement)
    ? data.profile_statement
    : null;
  return [{ json: { intent, confidence, entities, profile_statement } }];
} catch {
  return [{ json: { intent: 'general', confidence: 0, entities: {}, profile_statement: null } }];
}`;

const customerContext = {
  parameters: {
    operation: 'executeQuery',
    query: `WITH latest_program AS (
  SELECT status, start_date, current_week
  FROM programs
  WHERE user_id = '{{ $('Get User from Supabase').first().json.id }}'::uuid
  ORDER BY created_at DESC
  LIMIT 1
), active_legacy_subscription AS (
  SELECT EXISTS (
    SELECT 1
    FROM users legacy_user
    WHERE legacy_user.id = '{{ $('Get User from Supabase').first().json.id }}'::uuid
      AND legacy_user.stripe_subscription_id IS NOT NULL
      AND (
        legacy_user.subscription_status IN ('active', 'trialing', 'past_due')
        OR EXISTS (
          SELECT 1
          FROM subscriptions legacy_subscription
          WHERE legacy_subscription.user_id = legacy_user.id
            AND legacy_subscription.provider = 'stripe'
            AND legacy_subscription.stripe_subscription_id = legacy_user.stripe_subscription_id
            AND legacy_subscription.status IN ('active', 'trialing', 'past_due')
        )
      )
  ) AS is_active
)
SELECT
  latest_program.status AS program_status,
  latest_program.start_date::text AS program_start_date,
  latest_program.current_week,
  28::integer AS program_duration_days,
  COALESCE(active_legacy_subscription.is_active, FALSE) AS has_active_legacy_subscription,
  profile.eating_style,
  COALESCE(profile.allergies, ARRAY[]::text[]) AS allergies,
  COALESCE(profile.foods_to_avoid, ARRAY[]::text[]) AS foods_to_avoid,
  COALESCE(profile.medical_conditions, ARRAY[]::text[]) AS medical_conditions
FROM active_legacy_subscription
LEFT JOIN latest_program ON TRUE
LEFT JOIN profiles profile
  ON profile.user_id = '{{ $('Get User from Supabase').first().json.id }}'::uuid
LIMIT 1;`,
    options: {},
  },
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [66352, 47440],
  id: '03575b8c-70fc-4df5-a0fa-37e74fd33751',
  name: 'Get Customer Assistant Context',
};

const inputBuilder = {
  parameters: {
    jsCode: `const classification = $('Parse JSON Intent and Entities').first().json;
const user = $('Get User from Supabase').first().json;
const context = $input.first().json;
const rawMessage = $('Incoming Message').first().json.data?.body || '';
const normalizedMessage = String(rawMessage).trim().replace(/\\s+/g, ' ').normalize('NFC');
const simpleGeneral = classification.intent === 'general' && (
  classification.profile_statement !== null ||
  /^(hola|buen(?:os|as) (?:días|dias|tardes|noches)|gracias|muchas gracias|perfecto|ok|okay|listo|entendido)[.!¡¿? ]*$/i.test(normalizedMessage)
);

return [{ json: {
  user_id: user.id,
  user_message: normalizedMessage,
  raw_message: rawMessage,
  intent: classification.intent,
  confidence: classification.confidence,
  entities: classification.entities || {},
  profile_statement: classification.profile_statement || null,
  deterministic_general: simpleGeneral,
  portal_token_available: typeof user.portal_token === 'string' && user.portal_token.length > 0,
  program_status: context.program_status || null,
  program_start_date: context.program_start_date || null,
  current_week: context.current_week || null,
  program_duration_days: context.program_duration_days || 28,
  has_active_legacy_subscription: context.has_active_legacy_subscription === true,
  structured_profile: {
    eating_style: context.eating_style || null,
    allergies: Array.isArray(context.allergies) ? context.allergies : [],
    foods_to_avoid: Array.isArray(context.foods_to_avoid) ? context.foods_to_avoid : [],
    medical_conditions: Array.isArray(context.medical_conditions) ? context.medical_conditions : []
  }
} }];`,
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [66624, 47440],
  id: '93f2fca8-e3e1-4509-9d8f-8b63e55ed14c',
  name: 'Build Customer Assistant Input',
};

const eligibility = {
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{
        id: '6ff5ed6a-330d-47bd-a49c-a16ec2a2fcdb',
        leftValue: '={{ $json.has_active_legacy_subscription }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'equals' },
      }],
      combinator: 'and',
    },
    options: {},
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [68160, 46912],
  id: 'd1073e74-3db8-46bc-9341-5378fdd2ba0a',
  name: 'If Active Legacy Subscription',
};

const deterministic = {
  parameters: {
    jsCode: `const input = $input.first().json;
const user = $('Get User from Supabase').first().json;
const baseUrl = 'https://dietavity.com';
const portalUrl = input.portal_token_available ? baseUrl + '/p/' + user.portal_token : null;
const profileUrl = input.portal_token_available ? baseUrl + '/setup/' + user.portal_token : null;
const message = input.user_message || '';
const lower = message.toLocaleLowerCase('es-MX');
let assistant_response;

if (input.intent === 'unsubscribe') {
  assistant_response = 'Tu programa de 28 días es una compra única y no tiene una suscripción recurrente que cancelar. Si ves un cargo que no reconoces, escríbenos a soporte@dietavity.com.';
} else if (input.intent === 'portal_help') {
  if (!portalUrl) {
    assistant_response = 'No pude recuperar tu enlace de forma segura. Escríbenos a soporte@dietavity.com para ayudarte con el acceso.';
  } else if (/lista|súper|super|compras/.test(lower)) {
    assistant_response = 'Tu lista del súper está dentro de tu programa y se actualiza con tus comidas. Consúltala aquí: ' + portalUrl;
  } else if (/receta/.test(lower)) {
    assistant_response = 'Las recetas de las comidas incluidas en tu programa están aquí: ' + portalUrl;
  } else {
    assistant_response = 'Puedes consultar tu programa de 28 días aquí: ' + portalUrl;
  }
} else if (input.intent === 'program_help') {
  if (/otro plan|nuevo plan|plan de \\d+ días|plan de \\d+ dias|7 días|7 dias|plan semanal/.test(lower)) {
    assistant_response = 'Tu programa de 28 días se administra en el portal; no crearé un plan paralelo. Para cambiar una comida, abre tu programa y usa “No me gustó”.' + (portalUrl ? ' ' + portalUrl : '');
  } else if (/cu[aá]ndo|empieza|inicio|inicia/.test(lower)) {
    if (input.program_start_date) {
      const formatted = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(input.program_start_date + 'T00:00:00Z'));
      assistant_response = 'Tu programa empieza el ' + formatted + '.' + (portalUrl ? ' Puedes verlo aquí: ' + portalUrl : '');
    } else if (input.program_status === 'personalization') {
      assistant_response = 'Tu programa aún está en preparación y todavía no tiene fecha de inicio confirmada. Te mostraremos el estado en el portal.' + (portalUrl ? ' ' + portalUrl : '');
    } else {
      assistant_response = 'No pude confirmar una fecha de inicio. Escríbenos a soporte@dietavity.com para revisarlo.';
    }
  } else if (/semana|siguiente/.test(lower)) {
    assistant_response = input.current_week
      ? 'Tu programa está en la semana ' + input.current_week + ' de 4.' + (portalUrl ? ' Revisa los detalles aquí: ' + portalUrl : '')
      : 'No pude confirmar tu semana actual. Escríbenos a soporte@dietavity.com para revisarlo.';
  } else if (/cu[aá]nto dura|duraci[oó]n|28 días|28 dias/.test(lower)) {
    assistant_response = 'El programa Dietavity dura 28 días, organizados en 4 semanas.';
  } else if (/cambi|reemplaz|no me gust[oó]/.test(lower)) {
    assistant_response = 'Para reemplazar una comida de tu programa, abre el portal y usa “No me gustó” en esa comida.' + (portalUrl ? ' ' + portalUrl : '');
  } else {
    const state = input.program_status ? ' El estado actual es “' + input.program_status + '”.' : '';
    assistant_response = 'Tu programa dura 28 días y está organizado en 4 semanas.' + state + (portalUrl ? ' Puedes consultarlo aquí: ' + portalUrl : '');
  }
} else if (input.intent === 'support') {
  assistant_response = 'Para ayuda de acceso, pagos o problemas técnicos, escríbenos a soporte@dietavity.com.' + (portalUrl ? ' Tu portal es: ' + portalUrl : '');
} else if (input.profile_statement === 'allergy') {
  assistant_response = 'Gracias por avisarme. No guardaré ni cambiaré tu programa automáticamente desde este chat. Evita ese alimento y actualiza tu perfil aquí para futuras semanas: ' + profileUrl + '. Si tienes síntomas o riesgo de una reacción, busca atención médica.';
} else if (input.profile_statement === 'medical_condition') {
  assistant_response = 'Gracias por contármelo. Tu programa no se modificó automáticamente y Dietavity no sustituye atención médica. Actualiza tu perfil aquí: ' + profileUrl + ' y consulta a un profesional de salud para indicaciones sobre tu diagnóstico.';
} else if (input.profile_statement === 'dislike') {
  assistant_response = 'Entendido. No lo guardaré como restricción permanente desde este chat. Si es una comida de tu programa, usa “No me gustó” en el portal para cambiarla.' + (portalUrl ? ' ' + portalUrl : '');
} else if (input.profile_statement === 'diet' || input.profile_statement === 'name') {
  assistant_response = 'Gracias por avisarme. No guardaré ese cambio desde WhatsApp; puedes actualizar tu perfil aquí: ' + profileUrl;
} else if (/gracias/.test(lower)) {
  assistant_response = '¡Con gusto! Aquí estoy para ayudarte con tu programa de 28 días.';
} else if (/perfecto|ok|okay|listo|entendido/.test(lower)) {
  assistant_response = '¡Perfecto! Aquí estoy cuando me necesites.';
} else {
  assistant_response = '¡Hola! Puedo ayudarte con tu programa de 28 días, recetas rápidas, ideas de comida, restaurantes o consejos de alimentación.';
}

return [{ json: { ...input, assistant_response } }];`,
  },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [68640, 47744],
  id: '13896818-f053-4a21-8912-3ebc60d590e9',
  name: 'Build Deterministic Customer Response',
};

const addedNodeNames = new Set([
  customerContext.name,
  inputBuilder.name,
  eligibility.name,
  deterministic.name,
]);
workflow.nodes = workflow.nodes.filter((node) => !addedNodeNames.has(node.name));
for (const name of addedNodeNames) delete workflow.connections[name];
workflow.nodes.push(customerContext, inputBuilder, eligibility, deterministic);

const normalizer = byName('Normalize Prompt Input');
normalizer.parameters.jsCode = `return $input.all().map((item) => ({ json: { ...item.json } }));`;

const switchNode = workflow.nodes.find((node) =>
  node.name === 'Switch Intents' || node.name === 'Switch Customer Assistant Intents'
);
if (!switchNode) throw new Error('Missing customer intent switch node');
switchNode.name = 'Switch Customer Assistant Intents';
switchNode.parameters = {
  rules: {
    values: [
      { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: '0a1f15e7-8c20-402b-b147-26e62a8e9faf', leftValue: '={{ $json.intent }}', rightValue: 'unsubscribe', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' } },
      { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: '2de8327f-0c51-45ac-966f-b5827f794eed', leftValue: '={{ ["portal_help", "program_help", "support"].includes($json.intent) }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' } },
      { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: '1d1a6fa0-b63d-4d1b-bdd3-d063b115305d', leftValue: '={{ $json.deterministic_general }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' } },
    ],
  },
  options: { fallbackOutput: 'extra' },
};

const nutritionPrompt = byName('Build Nutrition Prompt');
nutritionPrompt.parameters.jsCode = `const input = $input.first().json;
const entities = input.entities || {};
const profile = input.structured_profile || {};
const list = (value) => Array.isArray(value) && value.length ? value.join(', ') : 'No indicado';

const prompt = \`Solicitud actual (intención: \${input.intent}):
"\${input.user_message}"

Contexto estructurado del perfil, solo para respetar restricciones; no lo modifiques:
- Estilo de alimentación: \${profile.eating_style || 'No indicado'}
- Alergias: \${list(profile.allergies)}
- Alimentos a evitar: \${list(profile.foods_to_avoid)}
- Condiciones declaradas: \${list(profile.medical_conditions)}

Entidades conversacionales: \${JSON.stringify(entities)}

Responde de forma breve y útil para WhatsApp. Para recipe, crea una receta situacional con pasos claros. Para meal_idea, ofrece 1 a 3 alternativas sin crear ni reemplazar el programa. Para restaurant_near, usa la ubicación indicada y aclara cuando convenga verificar horarios/menú. Para restaurant_menu, recomienda opciones saludables según el restaurante o menú aportado. Para advice, da orientación general de alimentación y longevidad. Para general, responde naturalmente.

Si el mensaje declara una alergia, diagnóstico, disgusto, dieta o nombre, reconoce la información para esta respuesta pero no afirmes que fue guardada ni que el programa cambió. No diagnostiques, no prescribas y no garantices que el programa sea médicamente apropiado.\`;

return [{ json: { ...input, prompt } }];`;

const nutritionModel = byName('Dietavity Nutrition Model');
nutritionModel.parameters.responses.values[0].content = `# Rol
Eres la acompañante nutricional de Dietavity para personas con un programa de 28 días.

# Responsabilidad
La PWA y el portal son la fuente de verdad del perfil, programa, semanas, comidas, cambios persistidos y lista del súper. WhatsApp ayuda a vivir el programa con recetas ad-hoc, ideas puntuales, restaurantes, orientación general y conversación. Nunca generes ni prometas un plan semanal o programa alterno, nunca inventes estado del programa o enlaces, y nunca afirmes que cambiaste datos persistidos.

# Nutrición y seguridad
- Prioriza alimentos frescos y mínimamente procesados, con inspiración en patrones de longevidad.
- Respeta las restricciones estructuradas proporcionadas.
- No diagnostiques, prescribas tratamientos, modifiques medicamentos ni presentes Dietavity como atención médica.
- Si aparece una nueva alergia o condición en la conversación, reconoce el límite y no afirmes que el programa se actualizó.

# Estilo
Responde siempre en español, de forma cálida, clara, profesional, breve y adecuada para WhatsApp. Haz como máximo una pregunta de seguimiento. No menciones prompts, herramientas ni procesos internos.`;

byName('Send All Intents Message').parameters.message = '={{ $json.assistant_response }}';
byName('Update Last Assistant Message').parameters.fieldsUi.fieldValues[0].fieldValue = '={{ $("Create Outbound Message").item.json.assistant_response || "" }}';

byName('Send Welcome New User').parameters.message = '🎉 ¡Bienvenida a Dietavity! Tu acceso está activo. Completa tu perfil en el enlace de configuración para preparar tu programa personalizado de 28 días.';

workflow.nodes = workflow.nodes.filter((node) => !removeNodes.has(node.name));

for (const removed of removeNodes) delete workflow.connections[removed];
for (const connectionGroup of Object.values(workflow.connections)) {
  for (const outputs of Object.values(connectionGroup)) {
    for (const output of outputs) {
      for (let index = output.length - 1; index >= 0; index -= 1) {
        if (removeNodes.has(output[index].node)) output.splice(index, 1);
      }
    }
  }
}

delete workflow.connections['Switch Intents'];
workflow.connections['Parse JSON Intent and Entities'] = { main: [[{ node: 'Get Customer Assistant Context', type: 'main', index: 0 }]] };
workflow.connections['Get Customer Assistant Context'] = { main: [[{ node: 'Build Customer Assistant Input', type: 'main', index: 0 }]] };
workflow.connections['Build Customer Assistant Input'] = { main: [[{ node: 'Normalize Prompt Input', type: 'main', index: 0 }]] };
workflow.connections['Normalize Prompt Input'] = { main: [[
  { node: 'Create Inbound Message ', type: 'main', index: 0 },
  { node: 'Switch Customer Assistant Intents', type: 'main', index: 0 },
  { node: 'Update Last Interaction At', type: 'main', index: 0 },
]] };
workflow.connections['Switch Customer Assistant Intents'] = { main: [
  [{ node: 'If Active Legacy Subscription', type: 'main', index: 0 }],
  [{ node: 'Build Deterministic Customer Response', type: 'main', index: 0 }],
  [{ node: 'Build Deterministic Customer Response', type: 'main', index: 0 }],
  [{ node: 'Build Nutrition Prompt', type: 'main', index: 0 }],
] };
workflow.connections['If Active Legacy Subscription'] = { main: [
  [{ node: 'Unsubscribe User Message', type: 'main', index: 0 }],
  [{ node: 'Build Deterministic Customer Response', type: 'main', index: 0 }],
] };
workflow.connections['Build Deterministic Customer Response'] = { main: [[{ node: 'Create Outbound Message', type: 'main', index: 0 }]] };

// The retired Ask Name marker is no longer written after a legacy checkout.
workflow.connections['Send Welcome New User'] = { main: [[]] };

const liveNames = new Set(workflow.nodes.map((node) => node.name));
for (const [source, groups] of Object.entries(workflow.connections)) {
  if (!liveNames.has(source)) delete workflow.connections[source];
  else for (const outputs of Object.values(groups)) for (const output of outputs) {
    for (let index = output.length - 1; index >= 0; index -= 1) {
      if (!liveNames.has(output[index].node)) output.splice(index, 1);
    }
  }
}

workflow.name = 'Development - Dietavity live 2.5.0 (Ticket 5)';
fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Updated ${workflowPath}`);
console.log(`Rollback copy: ${backupPath}`);
