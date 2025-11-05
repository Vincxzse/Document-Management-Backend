import fetch from 'node-fetch';

export async function sendNotificationSMS(recipient, message) {
  const res = await fetch('https://app.philsms.com/api/v3/sms/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.PHILSMS_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      recipient,
      sender_id: "BHCIntl",
      type: "plain",
      message
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'SMS failed');
  return data;
}
