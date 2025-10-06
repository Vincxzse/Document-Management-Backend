import Brevo from "@getbrevo/brevo"
import dotenv from "dotenv"

dotenv.config()

// Pass the API key in the client constructor
const brevoClient = new Brevo.TransactionalEmailsApi({
  apiKey: process.env.BREVO_API_KEY
})

export async function sendVerificationEmail(toEmail, code) {
    const sendSmtpEmail = new Brevo.SendSmtpEmail()

    sendSmtpEmail.subject = `Your verification code is ${code}`
    sendSmtpEmail.htmlContent = `
        <h2>Email Verification</h2>
        <p>Your confirmation code is:</p>
        <h1 style="color:blue;">${code}</h1>
    `

    sendSmtpEmail.sender = { email: "storagefirebase001@gmail.com", name: "Heroes" }
    sendSmtpEmail.to = [{ email: toEmail }]

    try {
        const response = await brevoClient.sendTransacEmail(sendSmtpEmail)
        return response
    } catch (error) {
        console.error("Email sending failed: ", error)
        throw error
    }
}
