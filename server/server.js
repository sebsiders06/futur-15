'use strict';

/**
 * =============================================================================
 * SCRIPT SERVEUR – Formulaire de contact
 * =============================================================================
 * Ce script reçoit les données du formulaire (Nom, Email, Message) en POST,
 * les nettoie pour éviter les injections, puis envoie un email à l'adresse
 * configurée. Pas d'utilisation de mailto: – tout passe par le serveur.
 * =============================================================================
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;

// ----- Configuration email -----
// Adresse qui reçoit les messages du formulaire (remplacer par la vôtre)
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'tonmail@example.com';
// Sujet fixe demandé pour chaque message
const EMAIL_SUBJECT = 'Nouveau message depuis le formulaire';
// Messages de réponse renvoyés au client (confirmation utilisateur)
const SUCCESS_MSG = 'Message envoyé avec succès !';
const ERROR_MSG = 'Erreur lors de l\'envoi.';
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';

// ----- Services d'envoi d'emails (au moins un doit être configuré dans .env) -----
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const GMAIL_USER = (process.env.GMAIL_USER || '').trim();
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').trim();
const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASSWORD = (process.env.SMTP_PASSWORD || '').trim();

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const gmailTransporter = (GMAIL_USER && GMAIL_APP_PASSWORD)
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    })
  : null;
const smtpTransporter = (SMTP_USER && SMTP_PASSWORD)
  ? nodemailer.createTransport({
      host: SMTP_HOST || 'smtp.orange.fr',
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD }
    })
  : null;

// ----- Middlewares -----
app.use(cors());                                    // Autoriser les requêtes depuis le front (même origine ou autre domaine)
app.use(express.json());                            // Lire le corps des requêtes POST en JSON
app.use(express.static(path.join(__dirname, '..'))); // Servir les fichiers statiques (HTML, CSS, images)

/**
 * Vérifie que la chaîne ressemble à une adresse email valide.
 * Évite d'accepter des valeurs arbitraires qui pourraient être utilisées pour des envois non désirés.
 */
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

/**
 * Nettoie une chaîne pour éviter les injections (XSS, injection dans l'email, etc.).
 * - On ne traite que des chaînes (pas d'utilisation directe de req.body sans typage).
 * - On supprime les espaces en début/fin et on limite la longueur pour éviter les abus.
 * Les données ne sont jamais utilisées "brutes" dans des requêtes ou du HTML.
 */
function sanitize(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen || 10000);
}

/**
 * Échappe les caractères spéciaux HTML pour afficher du texte dans un email HTML
 * sans risque d'injection de balises ou de script.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Route POST /api/contact
 * Reçoit les champs : nom, email, message.
 * 1. Récupère et nettoie les données (pas d'utilisation directe de req.body).
 * 2. Valide la présence et le format (email).
 * 3. Envoie l'email à CONTACT_EMAIL avec le sujet configuré.
 * 4. Retourne un JSON avec success et message pour la confirmation côté utilisateur.
 */
app.post('/api/contact', async (req, res) => {
  try {
    // ----- 1. Récupération et nettoyage des données (sécurisation) -----
    const { nom, email, message } = req.body || {};
    const nomClean = sanitize(nom, 200);
    const emailClean = (email && String(email).trim()) || '';
    const messageClean = sanitize(message, 5000);

    // ----- 2. Validation : refuser les données manquantes ou invalides -----
    if (!nomClean) {
      return res.status(400).json({ success: false, message: ERROR_MSG });
    }
    if (!emailClean) {
      return res.status(400).json({ success: false, message: ERROR_MSG });
    }
    if (!validateEmail(emailClean)) {
      return res.status(400).json({ success: false, message: ERROR_MSG });
    }
    if (!messageClean) {
      return res.status(400).json({ success: false, message: ERROR_MSG });
    }

    // ----- 3. Construction du contenu de l'email (texte + HTML sécurisé) -----
    const textBody = `Nom : ${nomClean}\nEmail : ${emailClean}\n\nMessage :\n${messageClean}`;
    const htmlBody = `<p><strong>Nom :</strong> ${escapeHtml(nomClean)}</p><p><strong>Email :</strong> ${escapeHtml(emailClean)}</p><p><strong>Message :</strong></p><p>${escapeHtml(messageClean).replace(/\n/g, '<br>')}</p>`;

    // ----- 4. Envoi selon le service configuré (Resend, Gmail ou SMTP) -----
    if (resend) {
      const { error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: CONTACT_EMAIL,
        replyTo: emailClean,
        subject: EMAIL_SUBJECT,
        text: textBody,
        html: htmlBody,
      });
      if (error) {
        console.error('Resend error:', error);
        return res.status(500).json({ success: false, message: ERROR_MSG });
      }
      return res.json({ success: true, message: SUCCESS_MSG });
    }

    if (gmailTransporter) {
      try {
        await gmailTransporter.sendMail({
          from: GMAIL_USER,
          to: CONTACT_EMAIL,
          replyTo: emailClean,
          subject: EMAIL_SUBJECT,
          text: textBody,
          html: htmlBody,
        });
        return res.json({ success: true, message: SUCCESS_MSG });
      } catch (err) {
        console.error('Nodemailer error:', err);
        return res.status(500).json({ success: false, message: ERROR_MSG });
      }
    }

    if (smtpTransporter) {
      try {
        await smtpTransporter.sendMail({
          from: SMTP_USER,
          to: CONTACT_EMAIL,
          replyTo: emailClean,
          subject: EMAIL_SUBJECT,
          text: textBody,
          html: htmlBody,
        });
        return res.json({ success: true, message: SUCCESS_MSG });
      } catch (err) {
        console.error('SMTP error:', err);
        return res.status(500).json({ success: false, message: ERROR_MSG });
      }
    }

    // Aucun service email configuré
    console.warn('Aucun service email configuré. Définir RESEND_API_KEY, GMAIL_* ou SMTP_* dans .env');
    return res.status(503).json({ success: false, message: ERROR_MSG });
  } catch (err) {
    console.error('POST /api/contact:', err);
    return res.status(500).json({ success: false, message: ERROR_MSG });
  }
});

// ----- Démarrage du serveur -----
app.listen(PORT, () => {
  console.log('Serveur démarré sur http://localhost:' + PORT);
  if (resend) console.log('Envoi d\'emails : Resend activé.');
  else if (gmailTransporter) console.log('Envoi d\'emails : Gmail activé.');
  else if (smtpTransporter) console.log('Envoi d\'emails : SMTP activé.');
  else console.warn('Aucun service email configuré. Définir les variables dans .env');
});
