import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST || "";
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER || "";
const pass = process.env.SMTP_PASS || "";
const fromDefault = process.env.MAIL_FROM || "no-reply@wessup.local";

let transporter = null;

if (host && user && pass) {
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    console.log(
      "Envoi mail désactivé (config SMTP manquante). To:",
      to,
      "Subject:",
      subject
    );
    return;
  }

  await transporter.sendMail({
    from: fromDefault,
    to,
    subject,
    text,
    html,
  });
}

