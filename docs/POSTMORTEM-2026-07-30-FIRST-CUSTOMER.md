# Dietavity First Production Customer Report

Date: July 30–31, 2026

# Overview

Dietavity received its first paying customer through the production Stripe checkout.
The purchase was successful, but several independent issues prevented the customer from receiving her program automatically.
The customer experience was affected, but the incident exposed critical production issues before a broader launch.

# Timeline

1. Customer completed payment
✅ Stripe Checkout succeeded.
The subscription was created successfully.
2. User creation
The user record was created successfully.
3. Ask Name flow failed
Error:
record "new" has no field "updated_at"
Cause:
The users table had an UPDATE trigger referencing NEW.updated_at, but the table did not contain an updated_at column.
Impact:
Customer's name was not saved.
Several later UPDATE users operations failed.
Status:
✅ Fixed by adding the missing updated_at column.
4. Meal plan creation failed
Error:
Could not find the 'duration_days' column of 'meal_plans'
Cause:
The Create Meal Plan node still referenced the old database schema (title and duration_days).
Impact:
The meal plan could not be persisted.
Status:
✅ Fixed by updating the node to match the current schema.
5. Workflow stalled
Because of the previous errors, the workflow did not reach successful completion.
The customer never received the portal link.
6. WhatsApp session expired
More than 24 hours elapsed before the workflow was repaired.
When attempting to send the portal link:
63016
Outside messaging window.
Use a WhatsApp Message Template.
Cause:
Meta's 24-hour customer service window had expired.
Impact:
The portal could not be delivered using a normal WhatsApp message.
Status:
A WhatsApp template has been submitted for approval.

# Root Causes

## Technical
Database trigger inconsistent with table schema.
Legacy n8n node using an outdated database schema.
No automated validation after schema changes.

## Operational
Workflow errors were not detected promptly.
No production alerting.
Errors accumulated for more than 24 hours before being noticed.

# Lessons Learned

## Database
Every schema change must be reflected in all n8n nodes before deployment.

## Workflow
Avoid maintaining multiple insertion flows for the same table.

## Monitoring
Production errors must generate immediate alerts.

## WhatsApp
Critical outbound messages (such as the portal link) should use approved Message Templates when delivery may occur outside the 24-hour window.

# Actions Completed

✅ Fixed users.updated_at issue.
✅ Fixed Create Meal Plan schema mismatch.
✅ Created a WhatsApp template for portal delivery.

# Remaining Actions
- Verify the full onboarding flow end-to-end.
- Verify automatic Week 1 generation.
- Confirm portal delivery after template approval.
- Implement production monitoring and alerts.

# Outcome

- The first production customer successfully validated:
- Stripe payment
- User creation
- Production infrastructure

The incident exposed two production bugs and one operational gap before wider adoption, allowing them to be corrected early.