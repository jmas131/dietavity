# Ticket 40: WhatsApp recovery poller

Generated artifacts:

- `n8n/Dietavity WhatsApp Recovery Poller.json`
- `n8n/Dietavity Sales Engine (Ticket 10).json`

Regenerate both with `node scripts/refactor-ticket-10-workflow.js`.

The poller contains the unchanged `Resume Verified WhatsApp Requests` schedule
(every minute), the unchanged `Find Verified WhatsApp Sessions` Postgres lookup,
and `Execute Dietavity Sales Engine`. An empty SELECT produces no items; the
lookup does not enable Always Output Data or continue on failure, so an empty
poll never reaches Execute Workflow. No additional IF node is needed.

Execute Workflow uses the established version 1 parameter format, database
source, `mode: once`, and waits for completion. It forwards the entire session
batch without remapping or creating an execution per session. Sales Engine's
version 1 Execute Workflow Trigger, `Receive Verified WhatsApp Sessions`, feeds
`Claim Next Session Inbound` directly. The original schedule and lookup are
removed from Sales Engine. All existing downstream and inbound nodes and edges
remain unchanged. The poller retains the existing Global Error Handler and
timezone. No database changes are required.

## Deployment (not performed)

Both artifacts are inactive. With separate production authorization:

1. Update the existing Sales Engine workflow with its generated artifact. Preserve
   its deployed workflow ID and restore its intended active inbound state.
2. Import the poller under the same owner as Sales Engine, retaining the existing
   same-owner caller policy. Verify the Postgres credential and Global Error
   Handler mapping. Set Execute Dietavity Sales Engine to the actual deployed
   Sales Engine ID (the export targets `rmQJsiYeHQ4Hc9XP`).
3. Before activation, validate in a non-production n8n instance with test data:
   an empty lookup must produce no Sales Engine execution; a nonempty lookup
   must invoke the Execute Workflow Trigger and reach the existing claim path.
   Verify a normal inbound test still enters through its existing entry point.
4. Activate the poller on the one-minute cadence after verifying Sales Engine
   no longer contains its old scheduled recovery entry point.

Local validation: 14 focused assertions/tests passed across Ticket 40, Ticket 34,
Ticket 30, and the directly affected recovery checks in Tickets 28A, 36, and 37.
A structural comparison against the pre-edit artifact confirmed both moved nodes
are identical and all remaining existing Sales Engine nodes, edges, and settings
are identical. No full regression suite or live n8n execution was run.
