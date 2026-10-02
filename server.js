require('dotenv').config({ path: '/root/.env' });
const express = require('express');
const path = require('path');
const crypto = require('node:crypto');
const supabase = require('./lib/supabase');
const axios = require('axios');
const { buildShoppingList } = require('./lib/shopping-list');
const { sendPrivacyRequest } = require('./lib/privacy-mailer');
const { sendPortalRecoveryEmail } = require('./lib/portal-recovery-mailer');
const {
  PortalRequestTimeoutError,
  createPortalDeadline,
  portalRequestTimeoutMs
} = require('./lib/portal-deadline');
const { parseListenerConfig } = require('./lib/listener-config');

const app = express();

// PARSE INCOMING JSON PAYLOADS

app.use(express.json({ limit: '32kb' }));

app.use(express.urlencoded({
  extended: true,
  limit: '32kb',
  parameterLimit: 100
}));

app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'public')));

const defaultPortalTimezone = 'America/Mexico_City';
const PRIVACY_NOTICE_VERSION = '2026-08-11';
const privacyRequestTypes = new Map([
  ['access', 'Acceso'],
  ['rectification', 'Rectificación'],
  ['cancellation', 'Cancelación'],
  ['objection', 'Oposición'],
  ['consent_revocation', 'Revocación del consentimiento'],
  ['other', 'Otra']
]);
const privacyRateLimitWindowMs = 15 * 60 * 1000;
const privacyRateLimitMax = 5;
const privacyRateLimitBuckets = new Map();
const recoveryRateLimitWindowMs = 15 * 60 * 1000;
const recoveryRateLimitMax = 5;
const recoveryRateLimitBuckets = new Map();
const recoveryTokenLifetimeMs = 45 * 60 * 1000;
const recoveryGenericMessage =
  'Si encontramos una compra asociada a ese correo, te enviaremos las instrucciones para recuperar tu acceso.';
const websiteCheckoutCookie = 'dietavity_website_checkout';
const metaPurchaseCookie = 'dietavity_meta_purchase';
const stripeProgramPriceId = 'price_1U1QlXCVZMBOTTlaU1QD7FRT';
const metaPixelId = /^[0-9]{5,20}$/.test(String(process.env.META_PIXEL_ID || '').trim())
  ? String(process.env.META_PIXEL_ID).trim()
  : '';
const portalRequestDeadlineMs = portalRequestTimeoutMs();

app.locals.metaPixelId = metaPixelId;

function websiteCheckoutToken(req) {
  const cookies = String(req.headers?.cookie || '').split(';');
  const cookie = cookies.find(value =>
    value.trim().startsWith(`${websiteCheckoutCookie}=`)
  );
  const token = cookie?.trim().slice(websiteCheckoutCookie.length + 1) || '';

  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function cookieValue(req, name) {
  const cookies = String(req.headers?.cookie || '').split(';');
  const cookie = cookies.find(value => value.trim().startsWith(`${name}=`));
  return cookie?.trim().slice(name.length + 1) || '';
}

function normalizeSingleLine(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMessage(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function validEmail(value) {
  return value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    !/[\r\n]/.test(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function recoveryRateLimited(req) {
  const now = Date.now();
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const current = recoveryRateLimitBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + recoveryRateLimitWindowMs }
    : current;

  bucket.count += 1;
  recoveryRateLimitBuckets.set(key, bucket);
  return bucket.count > recoveryRateLimitMax;
}

function setRecoveryResponseHeaders(res) {
  if (typeof res.set === 'function') {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
  }
}

function privacyRequestRateLimit(req, res, next) {
  const now = Date.now();
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const current = privacyRateLimitBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + privacyRateLimitWindowMs }
    : current;

  bucket.count += 1;
  privacyRateLimitBuckets.set(key, bucket);

  if (bucket.count > privacyRateLimitMax) {
    return res.status(429).render('privacy-request', {
      state: 'error',
      errorMessage: 'No pudimos recibir tu solicitud en este momento. Intenta de nuevo más tarde.',
      values: {},
      requestTypes: privacyRequestTypes
    });
  }

  next();
}

function resolvePortalTimezone(timezone) {

  let resolvedTimezone = timezone || defaultPortalTimezone;

  try {

    new Intl.DateTimeFormat('en-CA', {
      timeZone: resolvedTimezone
    }).format();

  } catch {

    resolvedTimezone = defaultPortalTimezone;

  }

  return resolvedTimezone;

}

async function resolvePortalUser(req) {

  const portalTokenHeader =
    req.headers?.['x-portal-token'];

  const portalToken = String(
    Array.isArray(portalTokenHeader)
      ? portalTokenHeader[0]
      : portalTokenHeader || ''
  ).trim();

  if (!portalToken) return null;

  const { data: user, error } = await supabase
    .from('users')
    .select('id')
    .eq('portal_token', portalToken)
    .maybeSingle();

  if (error) throw error;

  return user || null;

}

function portalCalendarDate(timezone, date = new Date()) {

  const resolvedTimezone = resolvePortalTimezone(timezone);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const value = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${value.year}-${value.month}-${value.day}`;

}

function addCalendarDays(dateString, days) {

  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);

}

function calendarDayDifference(startDate, endDate) {

  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);

  return Math.round((end - start) / 86400000);

}

function isCalendarDate(dateString) {

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {

    return false;

  }

  const date = new Date(`${dateString}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === dateString;

}

function formatPortalDate(dateString, timezone) {

  return new Intl.DateTimeFormat('es-MX', {
    timeZone: resolvePortalTimezone(timezone),
    dateStyle: 'long'
  }).format(new Date(`${dateString}T12:00:00Z`));

}

function normalizeProfile(body, userId) {

  return {

    user_id: userId,

    birth_month:
      body.birth_month
        ? Number(body.birth_month)
        : null,

    birth_year:
      body.birth_year
        ? Number(body.birth_year)
        : null,

    height_cm:
      body.height_cm
        ? Number(body.height_cm)
        : null,

    weight_kg:
      body.weight_kg
        ? Number(body.weight_kg)
        : null,

    eating_style:
      body.eating_style || null,

    medical_conditions:
      [].concat(body.medical_conditions || []),

    allergies:
      [].concat(body.allergies || []),

    foods_to_avoid:
      body.foods_to_avoid
        ? body.foods_to_avoid
            .split(',')
            .map(food => food.trim())
            .filter(Boolean)
        : [],

    notes:
      body.notes?.trim() || null

  };

}

{
const shoppingListCategories = [
  {
    name: 'Frutas y verduras'
  },
  {
    name: 'Proteínas'
  },
  {
    name: 'Lácteos y alternativas'
  },
  {
    name: 'Cereales y panes'
  },
  {
    name: 'Despensa'
  },
  {
    name: 'Otros'
  }
];

const shoppingListClassificationRules = [
  {
    category: 'Despensa',
    terms: [
      'crema de cacahuate', 'mantequilla de cacahuate',
      'crema de almendra', 'mantequilla de almendra',
      'caldo de verduras', 'caldo vegetal', 'agua',
      'almendra', 'almendras', 'avellana', 'avellanas', 'cacahuate',
      'cacahuates', 'nuez', 'nueces', 'pistache', 'pistaches',
      'semilla', 'semillas', 'chia', 'linaza', 'sesamo', 'ajonjoli',
      'pepita', 'pepitas', 'aceite', 'azucar', 'canela', 'comino',
      'curcuma', 'especia', 'especias', 'miel', 'mostaza', 'oregano',
      'paprika', 'pimenton', 'pimienta', 'sal', 'salsa', 'tamari',
      'salsa de soya', 'vinagre'
    ]
  },
  {
    category: 'Lácteos y alternativas',
    terms: [
      'bebida vegetal', 'yogur vegetal', 'leche vegetal',
      'leche de almendra', 'leche de avena', 'leche de coco',
      'leche de soya', 'bebida de almendra', 'bebida de avena',
      'bebida de coco', 'bebida de soya', 'crema vegetal',
      'queso vegetal', 'leche', 'yogur', 'yogurt', 'queso',
      'requeson', 'mantequilla', 'crema'
    ]
  },
  {
    category: 'Frutas y verduras',
    terms: [
      'aguacate', 'ajo', 'apio', 'albahaca', 'acelga', 'alcachofa',
      'arandano', 'arandanos', 'berenjena', 'berro', 'betabel',
      'brocoli', 'calabacin', 'calabaza', 'cebolla', 'champiñon',
      'champiñones', 'cilantro', 'col', 'coliflor', 'eneldo', 'espinaca',
      'espinacas', 'fresa', 'fresas', 'frambuesa', 'frambuesas',
      'frutos rojos', 'jitomate', 'kiwi', 'lechuga', 'limon', 'mango',
      'manzana', 'manzanas', 'menta', 'naranja', 'papa', 'papaya',
      'pepino', 'pera', 'perejil', 'pimiento', 'piña', 'platano',
      'rabano', 'rabanos', 'romero', 'rucula', 'tomate', 'uva', 'uvas',
      'verdura', 'verduras', 'zanahoria', 'zanahorias', 'zucchini'
    ]
  },
  {
    category: 'Proteínas',
    terms: [
      'alubia', 'alubias', 'atun', 'bacalao', 'carne', 'cerdo',
      'edamame', 'edamames', 'frijol', 'frijoles', 'garbanzo',
      'garbanzos', 'huevo', 'huevos', 'jamon', 'lenteja', 'lentejas',
      'marisco', 'mariscos', 'pavo', 'pescado', 'pollo', 'res',
      'salmon', 'sardina', 'sardinas', 'tempeh', 'tofu'
    ]
  },
  {
    category: 'Cereales y panes',
    terms: [
      'amaranto', 'arroz', 'avena', 'cebada', 'cereal', 'cereales',
      'cuscus', 'harina', 'maiz', 'pan', 'pasta', 'quinoa',
      'tortilla', 'tortillas', 'trigo'
    ]
  }
];

function foldIngredient(value) {

  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

}

function stripIngredientModifiers(value) {

  const modifierPatterns = [
    /,?\s+(?:cortad[oa]s?\s+)?en\s+(?:cubos|rodajas|rebanadas|tiras|trozos)$/i,
    /,?\s+(?:y\s+)?(?:finamente\s+)?(?:rallad[oa]s?|picad[oa]s?|cocid[oa]s?|escurrid[oa]s?)(?:\s+finamente)?$/i,
    /,?\s+(?:fresc[oa]s?|madur[oa]s?|pequeñ[oa]s?|grandes?)$/i,
    /,?\s+(?:al\s+gusto|opcional)$/i
  ];

  let normalized = value.trim();
  let previousValue;

  do {

    previousValue = normalized;

    modifierPatterns.forEach(pattern => {

      if (
        pattern.source.includes('fresc') &&
        foldIngredient(normalized) === 'queso fresco'
      ) {
        return;
      }

      normalized = normalized.replace(pattern, '').trim();

    });

  } while (normalized !== previousValue);

  return normalized;

}

function canonicalizeSingleIngredient(value) {

  let normalized = value
    .trim()
    .replace(/^[-•]\s*/, '')
    .replace(
      /^(?:(?:\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*)+/,
      ''
    )
    .replace(
      /^(?:g|gr|gramos?|kg|kilogramos?|ml|mililitros?|l|litros?|tazas?|cucharaditas?|cucharadas?|piezas?|rebanadas?|dientes?|puñados?)\b\.?\s*(?:de\s+)?/i,
      ''
    )
    .replace(/\s*\([^)]*\d[^)]*\)\s*$/, '')
    .replace(/,\s*\d.*$/, '')
    .trim();

  const folded = foldIngredient(normalized);

  if (
    /^(?:jugo|zumo)\s+de\b/.test(folded) &&
    /\blimon(?:es)?\b/.test(folded)
  ) {
    return 'Limón';
  }

  if (/^(?:medio\s+)?limon(?:es)?\b/.test(folded)) {
    return 'Limón';
  }

  normalized = stripIngredientModifiers(normalized);

  const canonicalAliases = new Map([
    ['aguacates', 'Aguacate'],
    ['palta', 'Aguacate'],
    ['paltas', 'Aguacate'],
    ['limones', 'Limón'],
    ['jitomate', 'Tomate'],
    ['jitomates', 'Tomate'],
    ['caldo vegetal', 'Caldo de verduras']
  ]);

  const alias =
    canonicalAliases.get(foldIngredient(normalized));

  if (alias) return alias;

  if (!normalized) return null;

  return normalized.charAt(0).toUpperCase() +
    normalized.slice(1);

}

function normalizeIngredient(ingredient) {

  const rawIngredient =
    typeof ingredient === 'string'
      ? ingredient
      : ingredient?.name ||
        ingredient?.ingredient ||
        ingredient?.title ||
        '';

  if (!rawIngredient.trim()) return null;

  const foldedRaw = foldIngredient(rawIngredient);

  if (
    (
      foldedRaw.includes('caldo de verduras') ||
      foldedRaw.includes('caldo vegetal')
    ) &&
    /\bagua\b/.test(foldedRaw)
  ) {
    return 'Caldo de verduras o agua';
  }

  const alternatives = rawIngredient
    .split(/\s+(?:o|u)\s+|\s+\/\s+/i)
    .map(canonicalizeSingleIngredient)
    .filter(Boolean)
    .filter((value, index, values) =>
      values.findIndex(candidate =>
        foldIngredient(candidate) === foldIngredient(value)
      ) === index
    );

  return alternatives.length
    ? alternatives.join(' o ')
    : null;

}

function ingredientDedupKey(ingredient) {

  return ingredient
    .split(' o ')
    .map(foldIngredient)
    .sort()
    .join(' o ');

}

function ingredientMatchesTerm(ingredient, term) {

  const searchableIngredient = foldIngredient(ingredient)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const escapedTerm = foldIngredient(term)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(
    `(?:^|\\s)${escapedTerm}(?=\\s|$)`
  ).test(searchableIngredient);

}

function categorizeIngredient(ingredient) {

  const matchingRule =
    shoppingListClassificationRules.find(rule =>
      rule.terms.some(term =>
        ingredientMatchesTerm(ingredient, term)
      )
    );

  return matchingRule?.category || 'Otros';

}

function buildShoppingListLegacy(mealPlan) {

  const groups = Object.fromEntries(
    shoppingListCategories.map(category => [category.name, []])
  );

  const seenIngredients = new Set();

  (mealPlan?.days || []).forEach(day => {

    Object.values(day.meals || {}).forEach(mealValue => {

      const meals =
        Array.isArray(mealValue)
          ? mealValue
          : [mealValue];

      meals.forEach(meal => {

        (meal?.recipe?.ingredients || []).forEach(ingredient => {

          const normalizedIngredient =
            normalizeIngredient(ingredient);

          if (!normalizedIngredient) return;

          const ingredientKey =
            ingredientDedupKey(normalizedIngredient);

          if (seenIngredients.has(ingredientKey)) return;

          seenIngredients.add(ingredientKey);

          const category =
            categorizeIngredient(normalizedIngredient);

          groups[category].push(normalizedIngredient);

        });

      });

    });

  });

  return shoppingListCategories.map(category => ({
    name: category.name,
    ingredients: groups[category.name].sort((a, b) =>
      a.localeCompare(b, 'es')
    )
  }));

}
}

app.get('/', (req, res) => {
  res.render('home');
});

app.get('/servicio', (req, res) => {
  res.render('service-features');
});

app.get('/programa-de-28-dias', (req, res) => {
  res.render('purchase');
});

app.get('/programa-glp1', (req, res) => {
  res.render('glp1-holding');
});

app.get('/comprar', (req, res) => {
  res.redirect(301, '/programa-de-28-dias');
});

app.get('/terminos-y-condiciones', (req, res) => {
  res.render('terms-and-conditions');
});

app.get('/aviso-de-privacidad', (req, res) => {
  res.render('privacy-policy', {
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION
  });
});

app.get('/privacidad/solicitud', (req, res) => {
  res.render('privacy-request', {
    state: 'form',
    errorMessage: null,
    values: {},
    requestTypes: privacyRequestTypes
  });
});

app.post(
  '/privacidad/solicitud',
  privacyRequestRateLimit,
  async (req, res) => {
    const values = {
      name: normalizeSingleLine(req.body.name),
      email: normalizeSingleLine(req.body.email).toLowerCase(),
      requestType: normalizeSingleLine(req.body.request_type),
      message: normalizeMessage(req.body.message)
    };

    if (normalizeSingleLine(req.body.company)) {
      return res.render('privacy-request', {
        state: 'success',
        errorMessage: null,
        values: {},
        requestTypes: privacyRequestTypes
      });
    }

    const requestTypeLabel = privacyRequestTypes.get(values.requestType);
    const invalid =
      !values.name ||
      values.name.length > 100 ||
      !validEmail(values.email) ||
      !requestTypeLabel ||
      !values.message ||
      values.message.length > 4000;

    if (invalid) {
      return res.status(400).render('privacy-request', {
        state: 'error',
        errorMessage: 'Revisa los campos requeridos e intenta de nuevo.',
        values,
        requestTypes: privacyRequestTypes
      });
    }

    try {
      await sendPrivacyRequest({
        name: values.name,
        email: values.email,
        requestTypeLabel,
        message: values.message
      });

      return res.render('privacy-request', {
        state: 'success',
        errorMessage: null,
        values: {},
        requestTypes: privacyRequestTypes
      });
    } catch (error) {
      console.error('Privacy request delivery failed.');

      return res.status(500).render('privacy-request', {
        state: 'error',
        errorMessage: 'No pudimos enviar tu solicitud. Intenta de nuevo.',
        values,
        requestTypes: privacyRequestTypes
      });
    }
  }
);

app.get('/recuperar-acceso', (req, res) => {
  setRecoveryResponseHeaders(res);
  return res.render('recover-access', {
    state: 'form',
    initiationToken: null,
    genericMessage: recoveryGenericMessage
  });
});

app.get('/recuperar-acceso/iniciar/:token', (req, res) => {
  const token = String(req.params?.token || '');
  setRecoveryResponseHeaders(res);

  return res.render('recover-access', {
    state: 'form',
    initiationToken: /^[a-f0-9]{64}$/.test(token) ? token : null,
    genericMessage: recoveryGenericMessage
  });
});

app.post('/recuperar-acceso', async (req, res) => {
  const email = normalizeSingleLine(req.body?.email).toLowerCase();
  const initiationToken = String(req.body?.initiation_token || '');
  const recoveryToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + recoveryTokenLifetimeMs).toISOString();
  const limited = recoveryRateLimited(req);
  setRecoveryResponseHeaders(res);

  try {
    if (!limited) {
      const { data, error } = await supabase.rpc('create_portal_recovery_request', {
        input_email: validEmail(email) ? email : '',
        input_token_hash: sha256(recoveryToken),
        input_expires_at: expiresAt,
        input_initiation_token_hash: initiationToken
          ? sha256(/^[a-f0-9]{64}$/.test(initiationToken) ? initiationToken : 'invalid')
          : null
      });

      if (error) throw error;
      const created = data === true || data?.created === true || data?.[0]?.created === true;

      if (created) {
        const recoveryUrl =
          `https://dietavity.com/recuperar-acceso/${recoveryToken}`;
        void sendPortalRecoveryEmail({ email, recoveryUrl }).catch(() => {
          console.error('Portal recovery email delivery failed.');
        });
      }
    }
  } catch {
    // The public response stays identical for unknown users and infrastructure
    // failures; operators still receive a credential-free diagnostic.
    console.error('Portal recovery request could not be created.');
  }

  return res.render('recover-access', {
    state: 'submitted',
    initiationToken: null,
    genericMessage: recoveryGenericMessage
  });
});

app.get('/recuperar-acceso/:token', async (req, res) => {
  const recoveryToken = String(req.params?.token || '');
  setRecoveryResponseHeaders(res);

  if (!/^[a-f0-9]{64}$/.test(recoveryToken)) {
    return res.status(404).render('recover-access', {
      state: 'invalid', initiationToken: null, genericMessage: recoveryGenericMessage
    });
  }

  try {
    const newPortalToken = crypto.randomBytes(32).toString('hex');
    const { data, error } = await supabase.rpc('redeem_portal_recovery', {
      input_token_hash: sha256(recoveryToken),
      input_new_portal_token: newPortalToken
    });

    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;

    if (result?.portal_token === newPortalToken) {
      return res.redirect(`/p/${newPortalToken}`);
    }

    if (
      result?.verification_purpose === 'link_whatsapp' &&
      ['linked', 'already_linked'].includes(result.whatsapp_link_status) &&
      result.resume_scheduled === true
    ) {
      return res.render('recover-access', {
        state: 'linked', initiationToken: null, genericMessage: recoveryGenericMessage
      });
    }

    if (result?.verification_purpose === 'link_whatsapp') {
      return res.render('recover-access', {
        state: 'support', initiationToken: null, genericMessage: recoveryGenericMessage
      });
    }
  } catch {
    console.error('Portal recovery link could not be redeemed.');
  }

  return res.status(404).render('recover-access', {
    state: 'invalid', initiationToken: null, genericMessage: recoveryGenericMessage
  });
});

app.post('/api/checkout', async (req, res) => {
  const stripeApiKey = process.env.STRIPE_API_KEY;

  if (!stripeApiKey) {
    console.error('Stripe API key is not configured for website Checkout.');

    return res.status(503).json({
      error: 'No pudimos iniciar el pago. Intenta de nuevo más tarde.'
    });
  }

  try {
    const existingToken = websiteCheckoutToken(req);
    let user = null;

    if (existingToken) {
      const { data, error } = await supabase
        .from('users')
        .select('id, portal_token, whatsapp_id')
        .eq('portal_token', existingToken)
        .is('whatsapp_id', null)
        .maybeSingle();

      if (error) throw error;
      user = data;
    }

    if (!user) {
      const portalToken = crypto.randomBytes(32).toString('hex');
      const { data, error } = await supabase
        .from('users')
        .insert({ whatsapp_id: null, portal_token: portalToken })
        .select('id, portal_token, whatsapp_id')
        .single();

      if (error) throw error;
      user = data;

      if (!user || user.portal_token !== portalToken || user.whatsapp_id != null) {
        throw new Error('Website customer identity could not be verified.');
      }
    }

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(String(user.id || '')) ||
      !/^[a-f0-9]{64}$/.test(String(user.portal_token || '')) ||
      user.whatsapp_id != null
    ) {
      throw new Error('Website customer identity is incomplete.');
    }

    res.cookie(websiteCheckoutCookie, user.portal_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/'
    });

    const parameters = new URLSearchParams({
      mode: 'payment',
      success_url: 'https://dietavity.com/pago-exitoso?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://dietavity.com/pago-cancelado',
      'line_items[0][price]': stripeProgramPriceId,
      'line_items[0][quantity]': '1',
      customer_creation: 'if_required',
      'metadata[user_id]': user.id,
      'metadata[acquisition_source]': 'website',
      'metadata[purchase_type]': '28_day_program',
      'metadata[program_version]': '1',
      'payment_intent_data[metadata][user_id]': user.id,
      'payment_intent_data[metadata][acquisition_source]': 'website',
      'payment_intent_data[metadata][purchase_type]': '28_day_program',
      'payment_intent_data[metadata][program_version]': '1'
    });

    const { data: checkout } = await axios.post(
      'https://api.stripe.com/v1/checkout/sessions',
      parameters.toString(),
      {
        headers: {
          Authorization: `Bearer ${stripeApiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': `dietavity-website-checkout:${user.id}`
        },
        timeout: 30000
      }
    );

    if (!checkout?.id || !/^https:\/\/checkout\.stripe\.com\//.test(checkout.url || '')) {
      throw new Error('Stripe returned an unusable Checkout Session.');
    }

    return res.json({ checkout_url: checkout.url });
  } catch (error) {
    console.error('Website Checkout could not be created.');

    return res.status(502).json({
      error: 'No pudimos iniciar el pago. Intenta de nuevo.'
    });
  }
});

app.get('/pago-exitoso', async (req, res) => {
  const sessionId = String(req.query?.session_id || '');

  if (!sessionId) {
    const purchaseChannel = cookieValue(req, metaPurchaseCookie);

    if (metaPixelId && ['website', 'whatsapp'].includes(purchaseChannel)) {
      res.cookie(metaPurchaseCookie, '', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 0,
        path: '/pago-exitoso'
      });

      const checkoutToken = purchaseChannel === 'website'
        ? websiteCheckoutToken(req)
        : null;

      return res.render('success', {
        paymentPending: false,
        purchaseVerified: true,
        setupPath: checkoutToken
          ? `/setup/${encodeURIComponent(checkoutToken)}`
          : null
      });
    }

    return res.render('success', {
      paymentPending: false,
      purchaseVerified: false,
      setupPath: null
    });
  }

  if (!/^cs_[a-zA-Z0-9_]{1,250}$/.test(sessionId)) {
    return res.status(400).send('El enlace de pago no es válido.');
  }

  try {
    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .select('user_id, payment_status')
      .eq('stripe_checkout_session_id', sessionId)
      .maybeSingle();

    if (purchaseError) throw purchaseError;

    if (!purchase || purchase.payment_status !== 'paid') {
      return res.render('success', {
        paymentPending: true,
        purchaseVerified: false,
        setupPath: null
      });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, whatsapp_id, portal_token')
      .eq('id', purchase.user_id)
      .single();

    if (userError || !user?.portal_token) {
      throw userError || new Error('Paid customer has no portal access token.');
    }

    if (metaPixelId) {
      res.cookie(metaPurchaseCookie, user.whatsapp_id ? 'whatsapp' : 'website', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 5 * 60 * 1000,
        path: '/pago-exitoso'
      });

      if (typeof res.set === 'function') res.set('Referrer-Policy', 'no-referrer');
      return res.redirect('/pago-exitoso');
    }

    if (!user.whatsapp_id) {
      return res.redirect(`/setup/${encodeURIComponent(user.portal_token)}`);
    }

    return res.render('success', {
      paymentPending: false,
      purchaseVerified: true,
      setupPath: null
    });
  } catch (error) {
    console.error('Paid customer access could not be resolved.');

    return res.status(500).send(
      'No pudimos confirmar tu acceso. Intenta nuevamente en unos momentos.'
    );
  }
});

app.get('/pago-cancelado', (req, res) => {
  res.render('cancel');
});

app.get('/setup/:portal_token', async (req, res) => {

  try {

    const { portal_token } = req.params;

    // FIND USER

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('portal_token', portal_token)
      .single();

    if (error || !user) {

      return res.status(404)
        .send('Este enlace no es válido.');

    }

    // FIND CURRENT PROGRAM STATE 

    const { data: program, error: programError } = await supabase
      .from('programs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (programError) {
      console.error(programError);

      return res.status(500)
        .send('Error al cargar el programa.');
    }

    // LOAD PROFILE

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError) {
      console.error(profileError);

      return res.status(500)
        .send('Error al cargar el perfil.');
    }

    res.render('setup', {
      user,
      profile,
      program
    });

  } catch (err) {

    console.error(err);

    res.status(500)
      .send('Error del servidor');

  }

});

app.post('/setup/:portal_token', async (req, res) => {

  try {

    const sensitiveDataConsent =
      req.body.sensitive_data_consent === 'on' ||
      req.body.sensitive_data_consent === 'true' ||
      req.body.sensitive_data_consent === '1';

    if (!sensitiveDataConsent) {

      return res
        .status(400)
        .send('Debes otorgar tu consentimiento para el tratamiento de datos personales sensibles.');

    }

    const { portal_token } = req.params;

    // FIND USER

    const {

      data: user,
      error: userError

    } = await supabase
      .from('users')
      .select('id, whatsapp_id')
      .eq('portal_token', portal_token)
      .single();

    if (userError || !user) {

      return res
        .status(404)
        .send('Este enlace no es válido.');

    }

    const name =
      String(req.body.name || '').trim();

    if (!name) {

      return res
        .status(400)
        .send('El nombre es obligatorio.');

    }

    const {
      data: existingProfile,
      error: existingProfileError
    } = await supabase
      .from('profiles')
      .select('sensitive_data_consent_at, privacy_notice_version')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingProfileError) {

      console.error(existingProfileError);

      return res
        .status(500)
        .send('Error al guardar el perfil.');

    }

    const sensitiveDataConsentAt =
      existingProfile?.privacy_notice_version === PRIVACY_NOTICE_VERSION &&
      existingProfile?.sensitive_data_consent_at
        ? existingProfile.sensitive_data_consent_at
        : new Date().toISOString();

    // NORMALIZE PROFILE

    const profileData = {
      ...normalizeProfile(req.body, user.id),
      sensitive_data_consent_at: sensitiveDataConsentAt,
      privacy_notice_version: PRIVACY_NOTICE_VERSION
    };

    // UPSERT PROFILE

    const {

      error: profileError

    } = await supabase
      .from('profiles')
      .upsert(profileData, {

        onConflict: 'user_id'

      });

    if (profileError) {

      console.error(profileError);

      return res
        .status(500)
        .send('Error al guardar el perfil.');

    }

    // KEEP users.name AS THE CANONICAL NAME

    const {
      data: updatedUser,
      error: nameError
    } = await supabase
      .from('users')
      .update({ name })
      .eq('id', user.id)
      .select('id')
      .maybeSingle();

    if (nameError || !updatedUser) {

      console.error(nameError || 'User name update returned no row.');

      return res
        .status(500)
        .send('Error al guardar el nombre.');

    }

    // START THE 28-DAY PROGRAM ONLY ON FIRST SETUP COMPLETION

    const {
      data: program,
      error: programError

    } = await supabase
      .from('programs')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (programError) {

      console.error(programError);

      return res
        .status(500)
        .send('Error al verificar el programa.');

    }

    if (!program) {

      const generationWebhookUrl =
        process.env.PROGRAM_GENERATION_WEBHOOK_URL ||
        process.env.GENERATE_PROGRAM_WEBHOOK_URL;

      if (!generationWebhookUrl) {

        console.error('Program generation webhook URL is not configured.');

        return res
          .status(500)
          .send('Error al iniciar la creación del programa.');

      }

      const generationResponse =
        await axios.post(
          generationWebhookUrl,
          { id: user.id },
          { timeout: 30000 }
        );

      if (
        generationResponse.status !== 200 &&
        generationResponse.status !== 202
      ) {

        throw new Error(
          `Unexpected program generation response: ${generationResponse.status}`
        );

      }

    }

    // Ticket 8 funnel milestone. This RPC uses the partial unique index's exact
    // conflict predicate so Setup retries are no-ops, while genuine errors remain
    // observable. Metadata intentionally excludes profile or consent details.
    const { error: setupEventError } = await supabase.rpc(
      'persist_setup_completed_event',
      {
        target_session_id: user.whatsapp_id || null,
        target_user_id: user.id,
        target_event_key:
          `setup_completed:${user.id}:${PRIVACY_NOTICE_VERSION}`
      }
    );

    if (setupEventError) {

      console.error(setupEventError);

      return res
        .status(500)
        .send('La configuración se guardó, pero no pudimos confirmar su finalización. Inténtalo de nuevo.');

    }

    // SUCCESS

    return res.redirect(
      `/p/${portal_token}`
    );

  } catch (err) {

    console.error(err);

    return res
      .status(500)
      .send('Error del servidor');

  }

});

app.get('/api/program-status', async (req, res) => {

  try {

    const portalUser = await resolvePortalUser(req);

    if (!portalUser) {

      return res.status(401).json({
        ready: false
      });

    }

    const { data: program, error: programError } =
      await supabase
        .from('programs')
        .select('id, status')
        .eq('user_id', portalUser.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (programError) throw programError;

    if (!program || program.status !== 'personalization') {

      return res.json({ ready: false });

    }

    const { data: week, error: weekError } =
      await supabase
        .from('weeks')
        .select('id')
        .eq('program_id', program.id)
        .eq('week_number', 1)
        .eq('status', 'planned')
        .maybeSingle();

    if (weekError) throw weekError;

    if (!week) {

      return res.json({ ready: false });

    }

    const { data: mealPlan, error: mealPlanError } =
      await supabase
        .from('meal_plans')
        .select('id')
        .eq('user_id', portalUser.id)
        .eq('program_id', program.id)
        .eq('week_id', week.id)
        .maybeSingle();

    if (mealPlanError) throw mealPlanError;

    return res.json({
      ready: Boolean(mealPlan)
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      ready: false
    });

  }

});

app.get('/p/:token', async (req, res) => {

  const requestId = crypto.randomUUID();
  const portalDeadline = createPortalDeadline({
    requestId,
    timeoutMs: portalRequestDeadlineMs
  });

  if (typeof res.set === 'function') {
    res.set('X-Request-ID', requestId);
  }

  try {

    const { token } = req.params;

    // FIND USER

    const { data: user, error: userError } =
      await portalDeadline.run('portal_user_lookup', () => supabase
        .from('users')
        .select('*')
        .eq('portal_token', token)
        .single());

    if (userError || !user) {

      return res.status(404)
        .send('Usuaria no encontrada');

    }

    // FIND THE USER'S LATEST PROGRAM

    const { data: program, error: programError } =
      await portalDeadline.run('portal_program_lookup', () => supabase
        .from('programs')
        .select('id, status, start_date')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle());

    if (programError) {

      return res.status(500)
        .send('Error al cargar el programa.');

    }

    if (!program) {

      return res.render('plan', {
        plan: null,
        user,
        portalState: {
          title: 'Aún no tienes un programa',
          messages: [
            'Cuando tengas un programa, podrás consultar tu plan aquí.'
          ]
        }
      });

    }

    if (program.status === 'completed') {

      return res.render('plan', {
        plan: null,
        user,
        portalState: {
          title: '¡Enhorabuena!',
          messages: [
            'Has completado tu programa de 28 días.',
            'Esperamos que durante estas cuatro semanas hayas adquirido hábitos saludables inspirados en algunas de las culturas más longevas del mundo.',
            'Muy pronto podrás comenzar un nuevo programa personalizado.'
          ]
        }
      });

    }

    if (
      program.status !== 'active' &&
      program.status !== 'personalization'
    ) {

      return res.render('plan', {
        plan: null,
        user,
        portalState: {
          title: 'Tu programa aún no está activo',
          messages: [
            'Tu plan aparecerá aquí cuando tu programa comience.'
          ]
        }
      });

    }

    // FIND THE WEEK TO DISPLAY

    const isPreparation =
      program.status === 'personalization';

    let currentWeekQuery =
      supabase
        .from('weeks')
        .select('id, week_number')
        .eq('program_id', program.id)
        .eq('status', isPreparation ? 'planned' : 'active');

    if (isPreparation) {

      currentWeekQuery =
        currentWeekQuery.eq('week_number', 1);

    }

    const { data: currentWeek, error: weekError } =
      await portalDeadline.run(
        'portal_current_week_lookup',
        () => currentWeekQuery.maybeSingle()
      );

    if (weekError) {

      return res.status(500)
        .send('Error al cargar la semana del programa.');

    }

    if (!currentWeek) {

      return res.render('plan', {
        plan: null,
        user,
        portalState: isPreparation
          ? {
              title: 'Estamos preparando tu programa personalizado',
              messages: [
                'Tarda solo unos minutos.'
              ],
              pollProgramStatus: true
            }
          : {
              title: 'No hay una semana activa',
              message: 'Tu plan aparecerá aquí cuando se active la siguiente semana.'
            }
      });

    }

    // FIND THE PLAN FOR THE ACTIVE PROGRAM WEEK

    const { data, error } =
      await portalDeadline.run('portal_current_meal_plan_lookup', () => supabase
        .from('meal_plans')
        .select('*')
        .eq('user_id', user.id)
        .eq('program_id', program.id)
        .eq('week_id', currentWeek.id)
        .maybeSingle());

    if (error) {

      return res.status(500)
        .send('Error al cargar el plan del programa.');

    }

    if (!data) {

      return res.render('plan', {
        plan: null,
        user,
        portalState: {
          title: 'Tu plan se está preparando',
          message: 'Vuelve a consultar este enlace en unos minutos.',
          pollProgramStatus: isPreparation
        }
      });

    }

    // FIND THE IMMEDIATE PREPARED SUCCESSOR IN THE SAME ACTIVE PROGRAM

    let upcomingWeek = null;
    let upcomingPlanData = null;

    if (!isPreparation && currentWeek.week_number < 4) {

      const { data: plannedSuccessor, error: upcomingWeekError } =
        await portalDeadline.run('portal_successor_week_lookup', () => supabase
          .from('weeks')
          .select('id, program_id, week_number')
          .eq('program_id', program.id)
          .eq('week_number', currentWeek.week_number + 1)
          .eq('status', 'planned')
          .is('activated_at', null)
          .maybeSingle());

      if (upcomingWeekError) {

        return res.status(500)
          .send('Error al cargar la próxima semana.');

      }

      if (plannedSuccessor) {

        const { data: plannedSuccessorPlan, error: upcomingPlanError } =
          await portalDeadline.run('portal_successor_meal_plan_lookup', () => supabase
            .from('meal_plans')
            .select('*')
            .eq('user_id', user.id)
            .eq('program_id', program.id)
            .eq('week_id', plannedSuccessor.id)
            .maybeSingle());

        if (upcomingPlanError) {

          return res.status(500)
            .send('Error al cargar el plan de la próxima semana.');

        }

        if (plannedSuccessorPlan) {

          upcomingWeek = plannedSuccessor;
          upcomingPlanData = plannedSuccessorPlan;

        }

      }

    }

    // FIND THE PREVIOUS WEEK'S PLAN IN THE SAME PROGRAM

    let previousPlan = null;

    if (!isPreparation && currentWeek.week_number > 1) {

      const { data: previousWeek, error: previousWeekError } =
        await portalDeadline.run('portal_previous_week_lookup', () => supabase
          .from('weeks')
          .select('id')
          .eq('program_id', program.id)
          .eq('week_number', currentWeek.week_number - 1)
          .maybeSingle());

      if (previousWeekError) {

        return res.status(500)
          .send('Error al cargar la semana anterior.');

      }

      if (previousWeek) {

        const { data: previousPlanData, error: previousPlanError } =
          await portalDeadline.run('portal_previous_meal_plan_lookup', () => supabase
            .from('meal_plans')
            .select('*')
            .eq('user_id', user.id)
            .eq('program_id', program.id)
            .eq('week_id', previousWeek.id)
            .maybeSingle());

        if (previousPlanError) {

          return res.status(500)
            .send('Error al cargar el plan anterior.');

        }

        previousPlan = previousPlanData;

      }

    }

    const weekNumber = currentWeek.week_number;

    const portalTimezone =
      user.timezone || defaultPortalTimezone;

    const startDateMin =
      portalCalendarDate(portalTimezone);

    const startDateMax =
      addCalendarDays(startDateMin, 30);

    const isScheduledPreparation =
      isPreparation &&
      isCalendarDate(program.start_date) &&
      calendarDayDifference(startDateMin, program.start_date) > 0;

    let programProgress = null;

    if (
      !isPreparation &&
      isCalendarDate(program.start_date)
    ) {

      const elapsedCalendarDays =
        calendarDayDifference(program.start_date, startDateMin);

      const day = Math.min(
        28,
        Math.max(1, elapsedCalendarDays + 1)
      );

      programProgress = {
        weekNumber,
        day,
        percentage: (day / 28) * 100
      };

    }

    const plan = {

      id: data.id,

      week_id: currentWeek.id,

      program_id: program.id,

      token,

      user_name: user.name || 'Dietavity',

      goal: 'Nutrición y bienestar',

      days: data.meals.days

    };

    const upcomingPlan = upcomingPlanData
      ? {
          id: upcomingPlanData.id,
          week_id: upcomingWeek.id,
          program_id: upcomingWeek.program_id,
          week_number: upcomingWeek.week_number,
          days: upcomingPlanData.meals.days
        }
      : null;

    const normalizePlanDays = planToNormalize => {

      if (!planToNormalize) return;

      planToNormalize.days.forEach(day => {

      // OLD SCHEMA FIX

      if (
        day.meals.snacks &&
        !day.meals.snack
      ) {

        day.meals.snack =
        day.meals.snacks[0];

      }

      Object.values(day.meals)
        .forEach(meal => {

          if (!meal.recipe) {

            meal.recipe = {

              ingredients: [],

              steps: []

            };

          }

        if (!meal.alternatives) {

          meal.alternatives = [];

        }

      });

      });

    };

    normalizePlanDays(plan);
    normalizePlanDays(upcomingPlan);

    res.render('plan', { 
      plan,
      upcomingPlan,
      user,
      previousPlan,
      weekNumber,
      programProgress,
      isPreparation,
      isScheduledPreparation,
      startDateMin,
      startDateMax,
      selectedStartDate: program.start_date,
      selectedStartDateLabel: program.start_date
        ? formatPortalDate(program.start_date, portalTimezone)
        : null,
      portalState: isPreparation
        ? isScheduledPreparation
          ? {
              title: 'Tu programa está listo',
              messages: [
                `Comenzarás tu programa de 28 días el ${formatPortalDate(program.start_date, portalTimezone)}.`
              ]
            }
          : {
              title: 'Prepara tu primera semana',
              messages: [
                'Revisa tus comidas antes de comenzar tu programa.'
              ]
            }
        : null
    });

  } catch (err) {

    if (err instanceof PortalRequestTimeoutError) {
      if (typeof res.set === 'function') {
        res.set('Retry-After', '60');
        res.set('Cache-Control', 'no-store');
      }

      return res.status(503).render('plan', {
        plan: null,
        user: null,
        portalState: {
          title: 'No pudimos cargar tu programa',
          messages: [
            'Inténtalo nuevamente en unos minutos.'
          ]
        }
      });
    }

    console.error(JSON.stringify({
      event: 'portal_request_failed',
      request_id: requestId
    }));

    return res.status(500)
      .send('Error del servidor');

  } finally {

    portalDeadline.finish();

  }

});

app.post('/p/:token/start', async (req, res) => {

  try {

    const { token } = req.params;
    const selectedDate = String(req.body.start_date || '');

    const { data: user, error: userError } =
      await supabase
        .from('users')
        .select('id, timezone')
        .eq('portal_token', token)
        .maybeSingle();

    if (userError || !user) {

      return res.status(404).send('Usuaria no encontrada');

    }

    const { data: program, error: programError } =
      await supabase
        .from('programs')
        .select('id, user_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (programError) {

      console.error(programError);
      return res.status(500).send('Error al cargar el programa.');

    }

    if (!program || program.user_id !== user.id) {

      return res.status(404).send('Programa no encontrado');

    }

    const today = portalCalendarDate(user.timezone);
    const lastAllowedDate = addCalendarDays(today, 30);

    if (
      !isCalendarDate(selectedDate) ||
      selectedDate < today ||
      selectedDate > lastAllowedDate
    ) {

      return res.status(400).send(
        'Selecciona una fecha entre hoy y los próximos 30 días.'
      );

    }

    const { error: startError } = await supabase.rpc(
      'start_program_week_one',
      {
        target_program_id: program.id,
        target_user_id: user.id,
        selected_start_date: selectedDate,
        portal_today: today
      }
    );

    if (startError) {

      console.error(startError);

      if (startError.message?.includes('START_DATE_ALREADY_SELECTED')) {

        return res.status(409).send(
          'La fecha de inicio de este programa ya fue seleccionada.'
        );

      }

      return res.status(409).send(
        'El programa ya no está listo para comenzar.'
      );

    }

    return res.redirect(`/p/${token}`);

  } catch (err) {

    console.error(err);
    return res.status(500).send('Error del servidor');

  }

});

app.get('/api/shopping-list/:planId', async (req, res) => {

  try {

    const portalUser = await resolvePortalUser(req);

    if (!portalUser) {

      return res.status(401).json({
        success: false,
        error: 'No autorizado'
      });

    }

    const { planId } = req.params;

    const { weekId, programId } = req.query;

    let shoppingListPlanQuery =
      supabase
        .from('meal_plans')
        .select('meals')
        .eq('id', planId)
        .eq('user_id', portalUser.id);

    if (weekId) {

      shoppingListPlanQuery =
        shoppingListPlanQuery.eq('week_id', weekId);

    }

    if (programId) {

      shoppingListPlanQuery =
        shoppingListPlanQuery.eq('program_id', programId);

    }

    const { data: mealPlan, error } =
      await shoppingListPlanQuery.maybeSingle();

    if (error || !mealPlan) {

      return res.status(404).json({
        success: false,
        error: 'Plan no encontrado'
      });

    }

    return res.json({
      success: true,
      groups: buildShoppingList(mealPlan.meals)
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      error: 'Error generando la lista del súper'
    });

  }

});

app.post('/api/regenerate-meal', async (req, res) => {

  try {

    const portalUser = await resolvePortalUser(req);

    if (!portalUser) {

      return res.status(401).json({
        success: false,
        error: 'No autorizado'
      });

    }

    // REQUEST DATA

    const {

      planId,
      weekId,
      programId,
      dayIndex,
      mealType

    } = req.body;

    // LOAD CANONICAL REGENERATION RESTRICTIONS

    const {
      data: canonicalProfile,
      error: profileError
    } = await supabase
      .from('profiles')
      .select('eating_style, allergies, foods_to_avoid, medical_conditions')
      .eq('user_id', portalUser.id)
      .maybeSingle();

    if (profileError) {

      console.error(profileError);

      return res.status(500).json({
        success: false,
        error: 'Error cargando restricciones del perfil'
      });

    }

    if (!canonicalProfile) {

      return res.status(409).json({
        success: false,
        error: 'Perfil no encontrado'
      });

    }

    const normalizeRestrictionList = value =>
      Array.isArray(value)
        ? value
            .filter(item => typeof item === 'string')
            .map(item => item.trim())
            .filter(Boolean)
        : [];

    const regenerationProfile = {
      eating_style:
        typeof canonicalProfile.eating_style === 'string' &&
        canonicalProfile.eating_style.trim()
          ? canonicalProfile.eating_style.trim()
          : null,
      allergies:
        normalizeRestrictionList(canonicalProfile.allergies),
      foods_to_avoid:
        normalizeRestrictionList(canonicalProfile.foods_to_avoid),
      medical_conditions:
        normalizeRestrictionList(canonicalProfile.medical_conditions)
    };

    // FETCH PLAN

    let regeneratePlanQuery = supabase
      .from('meal_plans')
      .select('*')
      .eq('id', planId)
      .eq('user_id', portalUser.id);

    if (weekId) {

      regeneratePlanQuery =
        regeneratePlanQuery.eq('week_id', weekId);

    }

    if (programId) {

      regeneratePlanQuery =
        regeneratePlanQuery.eq('program_id', programId);

    }

    const {

      data: plan,
      error

    } = await regeneratePlanQuery.maybeSingle();

    if (error || !plan) {

      return res.status(404).json({

        success: false,
        error: 'Plan no encontrado'

      });

    }

    // EXTRACT CURRENT MEAL

    const meals =

      plan.meals.days[dayIndex]
        .meals;

    // OLD SCHEMA FIX

    if (
      meals.snacks &&
      !meals.snack
    ) {

      meals.snack =
        meals.snacks[0];

    }

    const currentMeal =

      meals[mealType];

    // CALL N8N WEBHOOK

    const webhookResponse =

      await axios.post(

        process.env.REGENERATE_WEBHOOK_URL,

        {

          currentMeal,

          mealType,

          profile: regenerationProfile

        },
        
        {
          timeout: 30000

        }

      );

    // EXTRACT NEW MEAL

    const newMeal =
    
      webhookResponse.data.meal;

    if (!newMeal) {

      return res.status(502).json({

        success: false,
        error: 'No se recibió una comida válida'

      });

    }

    // UPDATE PLAN JSON

    const applyMealReplacement = mealPlan => {

      const targetMeals =
        mealPlan.meals.days[dayIndex].meals;

      if (
        mealType === 'snack' &&
        Array.isArray(targetMeals.snacks)
      ) {

        targetMeals.snacks[0] = newMeal;
        targetMeals.snack = newMeal;

      } else {

        targetMeals[mealType] = newMeal;

      }

    };

    let planToUpdate = plan;
    let persisted = false;

    applyMealReplacement(planToUpdate);

    // PERSIST UPDATED PLAN

    for (let attempt = 0; attempt < 2; attempt++) {

      const { data: updatedPlan, error: updateError } =
        await supabase
          .from('meal_plans')
          .update({

            meals: planToUpdate.meals,
            updated_at: new Date().toISOString()

          })
          .eq('id', planId)
          .eq('user_id', portalUser.id)
          .eq('updated_at', planToUpdate.updated_at)
          .select('id')
          .maybeSingle();

      if (updateError) {

        console.error(updateError);

        return res.status(500).json({

          success: false,
          error: 'Error guardando comida'

        });

      }

      if (updatedPlan) {

        persisted = true;
        break;

      }

      const { data: latestPlan, error: latestPlanError } =
        await supabase
          .from('meal_plans')
          .select('meals, updated_at')
          .eq('id', planId)
          .eq('user_id', portalUser.id)
          .maybeSingle();

      if (latestPlanError || !latestPlan) {

        console.error(latestPlanError);

        return res.status(500).json({

          success: false,
          error: 'Error recargando el plan'

        });

      }

      planToUpdate = latestPlan;
      applyMealReplacement(planToUpdate);

    }

    if (!persisted) {

      return res.status(409).json({

        success: false,
        error: 'El plan cambió durante la actualización. Inténtalo nuevamente.'

      });

    }

    // RETURN TO FRONTEND

    res.json({

      success: true,

      meal: newMeal

    });

  } catch (err) {

    console.error(err);

    res.status(500).json({

      success: false,

      error: 'Error regenerando comida'

    });

  }

});

// MANIFEST.JSON

app.get('/manifest/:token.json', (req, res) => {

  res.setHeader(
    'Content-Type',
    'application/manifest+json'
  );

  const { token } = req.params;

  res.json({

    name: 'Dietavity',

    short_name: 'Dietavity',

    start_url: `/p/${token}`,

    scope: `/p/${token}`,

    display: 'standalone',

    background_color: '#F5F1E8',

    theme_color: '#F5F1E8',

    icons: [

      {
        src: '/images/icon-192.png',
        sizes: '192x192',
        type: 'image/png'
      },

      {
        src: '/images/icon-512.png',
        sizes: '512x512',
        type: 'image/png'
      }

    ]

  });

});

app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    if (req.path === '/privacidad/solicitud') {
      return res.status(413).render('privacy-request', {
        state: 'error',
        errorMessage: 'No pudimos recibir tu solicitud. Revisa el mensaje e intenta de nuevo.',
        values: {},
        requestTypes: privacyRequestTypes
      });
    }

    return res.status(413).send('La solicitud es demasiado grande.');
  }

  next(error);
});

if (require.main === module) {
  try {
    const listener = parseListenerConfig();
    app.listen(listener.port, listener.host, () => {
      console.log(`Dietavity listening on ${listener.host}:${listener.port}`);
    });
  } catch {
    // Do not print supplied configuration values. A malformed listener must
    // stop rather than falling back to an accidental wildcard bind.
    console.error('Dietavity listener configuration invalid');
    process.exitCode = 1;
  }

}

module.exports = app;
