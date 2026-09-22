const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, 'n8n', 'Dietavity live 2.4.3.json');
const backupPath = path.join(root, 'archive', 'Dietavity live 2.4.3 pre-ticket-6.json');

if (!fs.existsSync(backupPath)) fs.copyFileSync(workflowPath, backupPath);

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const byName = (name) => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Missing workflow node: ${name}`);
  return node;
};

const removeNode = (name) => {
  workflow.nodes = workflow.nodes.filter((node) => node.name !== name);
  delete workflow.connections[name];
  for (const groups of Object.values(workflow.connections)) {
    for (const outputs of Object.values(groups)) {
      for (const output of outputs) {
        for (let index = output.length - 1; index >= 0; index -= 1) {
          if (output[index].node === name) output.splice(index, 1);
        }
      }
    }
  }
};

workflow.name = 'Development - Dietavity live 2.5.1 (Ticket 6)';

const stripeResult = byName('If Stripe Unsubscribe ');
stripeResult.parameters.conditions.conditions = [
  {
    id: 'f3d4cbc6-2916-493d-a7b9-1c7475876000',
    leftValue: '={{ $json.status }}',
    rightValue: 'canceled',
    operator: { type: 'string', operation: 'equals' },
  },
  {
    id: 'a0290328-564e-4d02-8a6c-f53d7ea2bf97',
    leftValue: '={{ $json.object }}',
    rightValue: 'subscription',
    operator: { type: 'string', operation: 'equals' },
  },
  {
    id: '4e63a23b-6fac-437c-b795-da18b648ebbe',
    leftValue: '={{ $json.id }}',
    rightValue: "={{ $('Get User from Supabase').item.json.stripe_subscription_id }}",
    operator: { type: 'string', operation: 'equals' },
  },
];

const persistCancellation = {
  parameters: {
    operation: 'executeQuery',
    query: `WITH target_user AS (
  SELECT legacy_user.id, legacy_user.preferences, legacy_user.subscription_status
  FROM public.users AS legacy_user
  WHERE legacy_user.id = '{{ $('Get User from Supabase').first().json.id }}'::uuid
    AND legacy_user.stripe_subscription_id = '{{ $('Stripe Cancel a Subscription').first().json.id }}'
  FOR UPDATE
), updated_user AS (
  UPDATE public.users AS legacy_user
  SET subscription_status = 'canceled',
      updated_at = NOW()
  FROM target_user
  WHERE legacy_user.id = target_user.id
    AND legacy_user.subscription_status IS DISTINCT FROM 'canceled'
  RETURNING legacy_user.id
), updated_subscription AS (
  UPDATE public.subscriptions AS legacy_subscription
  SET status = 'canceled'
  FROM target_user
  WHERE legacy_subscription.user_id = target_user.id
    AND legacy_subscription.provider = 'stripe'
    AND legacy_subscription.stripe_subscription_id = '{{ $('Stripe Cancel a Subscription').first().json.id }}'
    AND legacy_subscription.status IS DISTINCT FROM 'canceled'
  RETURNING legacy_subscription.id
), inserted_metric AS (
  INSERT INTO public.unsubscribed_metrics (
    region,
    allergies,
    dislikes,
    conditions,
    diet,
    cuisine,
    unsubscribed_at
  )
  SELECT
    NULLIF(target_user.preferences->>'region', ''),
    CASE
      WHEN jsonb_typeof(target_user.preferences->'allergies') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(target_user.preferences->'allergies'))
      ELSE ARRAY[]::text[]
    END,
    CASE
      WHEN jsonb_typeof(target_user.preferences->'dislikes') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(target_user.preferences->'dislikes'))
      ELSE ARRAY[]::text[]
    END,
    CASE
      WHEN jsonb_typeof(target_user.preferences->'conditions') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(target_user.preferences->'conditions'))
      ELSE ARRAY[]::text[]
    END,
    NULLIF(target_user.preferences->>'diet', ''),
    NULLIF(target_user.preferences->>'cuisine', ''),
    NOW()
  FROM target_user
  WHERE EXISTS (SELECT 1 FROM updated_user)
  RETURNING id
)
SELECT
  EXISTS (SELECT 1 FROM target_user) AS user_matched,
  EXISTS (SELECT 1 FROM updated_user) AS user_subscription_canceled,
  EXISTS (SELECT 1 FROM updated_subscription) AS subscription_row_canceled,
  (
    EXISTS (SELECT 1 FROM target_user)
    AND (
      EXISTS (SELECT 1 FROM updated_user)
      OR EXISTS (
        SELECT 1
        FROM target_user
        WHERE target_user.subscription_status = 'canceled'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.subscriptions AS active_subscription
      CROSS JOIN target_user
      WHERE active_subscription.user_id = target_user.id
        AND active_subscription.provider = 'stripe'
        AND active_subscription.stripe_subscription_id = '{{ $('Stripe Cancel a Subscription').first().json.id }}'
        AND active_subscription.status IN ('active', 'trialing', 'past_due')
        AND NOT EXISTS (
          SELECT 1
          FROM updated_subscription
          WHERE updated_subscription.id = active_subscription.id
        )
    )
  ) AS local_state_canceled,
  (SELECT id FROM inserted_metric LIMIT 1) AS unsubscribe_metric_id;`,
    options: {},
  },
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [72016, 45504],
  id: 'cbd8fb30-2d58-4f83-aacd-0095e510841b',
  name: 'Persist Legacy Cancellation',
  credentials: {
    postgres: {
      id: 'gXJ1myheSM6x1XB8',
      name: 'Postgres account',
    },
  },
};

removeNode('Delete User');
removeNode('Create Unsubscribe Metrics Row');
workflow.nodes = workflow.nodes.filter((node) => node.name !== persistCancellation.name);
workflow.nodes.push(persistCancellation);

const localPersistenceResult = {
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{
        id: '29035652-dca8-4e34-9c87-fb26bec5d58e',
        leftValue: '={{ $json.local_state_canceled }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'equals' },
      }],
      combinator: 'and',
    },
    options: {},
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [72224, 45504],
  id: 'e1c48891-7af4-4766-8750-9c7a7bec67d0',
  name: 'If Local Cancellation Persisted',
};
workflow.nodes = workflow.nodes.filter((node) => node.name !== localPersistenceResult.name);
workflow.nodes.push(localPersistenceResult);

const confirmation = byName('Send Unsubscribe Message');
confirmation.parameters.message = 'Tu suscripción ha sido cancelada correctamente. No se realizarán más cargos recurrentes por esa suscripción.';

const fallback = workflow.nodes.find((node) => (
  node.name === 'Send Unsubscribe Delay Message'
  || node.name === 'Send Unsubscribe Unconfirmed Message'
));
if (!fallback) throw new Error('Missing unsubscribe fallback message node');
fallback.name = 'Send Unsubscribe Unconfirmed Message';
fallback.parameters.message = 'No pudimos confirmar la cancelación en este momento. No marcaremos tu suscripción como cancelada hasta verificarla. Por favor, inténtalo de nuevo o escríbenos a soporte@dietavity.com.';

delete workflow.connections['Send Unsubscribe Delay Message'];
workflow.connections['Send Unsubscribe Unconfirmed Message'] = { main: [[]] };
workflow.connections['If Stripe Unsubscribe '] = {
  main: [
    [{ node: 'Persist Legacy Cancellation', type: 'main', index: 0 }],
    [{ node: 'Send Unsubscribe Unconfirmed Message', type: 'main', index: 0 }],
  ],
};
workflow.connections['Persist Legacy Cancellation'] = {
  main: [[{ node: 'If Local Cancellation Persisted', type: 'main', index: 0 }]],
};
workflow.connections['If Local Cancellation Persisted'] = {
  main: [
    [{ node: 'Send Unsubscribe Message', type: 'main', index: 0 }],
    [{ node: 'Send Unsubscribe Unconfirmed Message', type: 'main', index: 0 }],
  ],
};

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
