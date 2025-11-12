import axios from "axios"

export async function sendSMS(to, message) {
  const apiKey = process.env.IPROG_API_KEY

  if (!to || !message) {
    console.log("Recipient number and message are required.")
    return
  }

  const url = "https://sms.iprogtech.com/api/v1/sms_messages"

  try {
    const response = await axios.post(url, {
      api_token: apiKey,
      phone_number: to,
      message: message
    })

    console.log("SMS Sent Successfully:", response.data)
  } catch (error) {
    console.error("Failed to send SMS:", error.response?.data || error.message)
  }
}

// Example usage
// sendSMS("639171234567", "Hello from iProg API!")
