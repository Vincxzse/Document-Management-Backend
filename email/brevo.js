console.log("📦 brevo.js module loaded successfully");

import Brevo from "@getbrevo/brevo";
import dotenv from "dotenv";

// Load .env only in development
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
  console.log("⚙️ Loaded .env for development environment");
}

// Initialize Brevo client
const brevoClient = new Brevo.TransactionalEmailsApi();
brevoClient.authentications["apiKey"].apiKey = process.env.BREVO_API_KEY;

export async function sendVerificationEmail(toEmail, code) {
  console.log("🟦 sendVerificationEmail() called");
  console.log("🟦 Sending email to:", toEmail);
  console.log("🟦 Verification code:", code);
  console.log("🟦 Brevo API Key present:", !!process.env.BREVO_API_KEY);

  const sendSmtpEmail = new Brevo.SendSmtpEmail();
  sendSmtpEmail.subject = `Your verification code is ${code}`;
  sendSmtpEmail.htmlContent = `
    <h2>Email Verification</h2>
    <p>Your confirmation code is:</p>
    <h1 style="color:blue;">${code}</h1>
  `;
  sendSmtpEmail.sender = { email: "storagefirebase001@gmail.com", name: "Heroes" };
  sendSmtpEmail.to = [{ email: toEmail }];

  try {
    console.log("📤 Attempting to send email via Brevo API...");
    const response = await brevoClient.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Email sent successfully!");
    console.log("📩 Brevo API Response:", JSON.stringify(response, null, 2));
    return response;
  } catch (error) {
    console.error("❌ Email sending failed!");
    console.error("Error details:", error.response?.body || error);
    throw error;
  }
}
