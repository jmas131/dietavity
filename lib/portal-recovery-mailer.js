const nodemailer = require('nodemailer');

function createPortalRecoveryTransport() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '');
  const port = Number(process.env.SMTP_PORT || 587);

  if (!host || !user || !pass || !Number.isInteger(port)) {
    throw new Error('Portal recovery email delivery is not configured.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass }
  });
}

async function sendPortalRecoveryEmail({ email, recoveryUrl }) {
  const transport = createPortalRecoveryTransport();
  const from = String(
    process.env.PORTAL_RECOVERY_EMAIL_FROM || process.env.SMTP_USER || ''
  ).trim();

  if (!from) throw new Error('Portal recovery email sender is not configured.');

  await transport.sendMail({
    from,
    to: email,
    subject: 'Verifica tu acceso a Dietavity',
    text: [
      'Recibimos una solicitud para verificar tu acceso a Dietavity.',
      '',
      'Abre este enlace durante los próximos 45 minutos:',
      recoveryUrl,
      '',
      'Si tú no hiciste esta solicitud, puedes ignorar este mensaje.'
    ].join('\n')
  });
}

module.exports = { sendPortalRecoveryEmail };
