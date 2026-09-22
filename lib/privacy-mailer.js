const nodemailer = require('nodemailer');

const PRIVACY_REQUEST_DESTINATION = 'soporte@dietavity.com';

function createPrivacyTransport() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '');
  const port = Number(process.env.SMTP_PORT || 587);

  if (!host || !user || !pass || !Number.isInteger(port)) {
    throw new Error('Privacy email delivery is not configured.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass }
  });
}

async function sendPrivacyRequest({ name, email, requestTypeLabel, message }) {
  const transport = createPrivacyTransport();
  const from = String(process.env.PRIVACY_EMAIL_FROM || process.env.SMTP_USER || '').trim();

  if (!from) {
    throw new Error('Privacy email sender is not configured.');
  }

  await transport.sendMail({
    from,
    to: PRIVACY_REQUEST_DESTINATION,
    replyTo: email,
    subject: `Solicitud de privacidad Dietavity — ${requestTypeLabel}`,
    text: [
      `Nombre: ${name}`,
      `Correo electrónico: ${email}`,
      `Tipo de solicitud: ${requestTypeLabel}`,
      '',
      'Mensaje:',
      message
    ].join('\n')
  });
}

module.exports = { sendPrivacyRequest };