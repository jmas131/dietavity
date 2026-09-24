'use strict';

const crypto = require('node:crypto');

const COMMERCIAL_AUTHORIZATION_SUBJECT_VERSION = 'commercial-authorization-subject-v1';
const COMMERCIAL_CATEGORY = 'commercial_purchase_intent';
const SUBJECT_ID_PATTERN = /^cas-[0-9a-f]{64}$/;

function subjectTuple({ campaign, offerVersion }) {
  if (!['standard', 'glp1_validation'].includes(campaign) || typeof offerVersion !== 'string' || !offerVersion) throw new TypeError('COMMERCIAL_AUTHORIZATION_SUBJECT_INPUT_INVALID');
  return [COMMERCIAL_AUTHORIZATION_SUBJECT_VERSION, COMMERCIAL_CATEGORY, campaign, offerVersion];
}

function deriveCommercialAuthorizationSubject(input) {
  const tuple = subjectTuple(input);
  const digest = crypto.createHash('sha256').update(JSON.stringify(tuple), 'utf8').digest('hex');
  return Object.freeze({ authorization_subject_version: COMMERCIAL_AUTHORIZATION_SUBJECT_VERSION, authorization_subject_id: `cas-${digest}` });
}

function commercialAuthorizationSubjectValid(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2
    && value.authorization_subject_version === COMMERCIAL_AUTHORIZATION_SUBJECT_VERSION
    && typeof value.authorization_subject_id === 'string'
    && SUBJECT_ID_PATTERN.test(value.authorization_subject_id);
}

module.exports = { COMMERCIAL_AUTHORIZATION_SUBJECT_VERSION, SUBJECT_ID_PATTERN, commercialAuthorizationSubjectValid, deriveCommercialAuthorizationSubject, subjectTuple };
