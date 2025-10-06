import Brevo from "@getbrevo/brevo"
import dotenv from "dotenv"

dotenv.config()

const brevoClient = new Brevo.TransactionalEmailsApi()
brevoClient.authentications["apiKey"].apiKey = "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"

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