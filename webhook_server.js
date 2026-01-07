/**
 * WhatsApp Webhook Handler - Node.js
 * Receives incoming WhatsApp messages and processes them through AI pipeline
 */

const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Configuration
const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'wa_api_2026';
const CLOUD_FUNCTION_URL = 'https://whatsapp-proxy-66mhuvutfa-uc.a.run.app';
const PROCESSING_API_URL = process.env.PROCESSING_API_URL || 'http://localhost:5000/api/process-approval';

console.log('WhatsApp Webhook Server Starting...');
console.log(`Port: ${PORT}`);
console.log(`Verify Token: ${VERIFY_TOKEN}`);
console.log(`Cloud Function: ${CLOUD_FUNCTION_URL}`);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'whatsapp-webhook',
    cloud_function: CLOUD_FUNCTION_URL
  });
});

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    res.status(403).send('Verification failed');
  }
});

// Webhook message receiver (POST)
app.post('/webhook', async (req, res) => {
  try {
    const data = req.body;

    console.log('📨 Received webhook:', JSON.stringify(data, null, 2));

    // Quick response to Meta
    res.status(200).json({ status: 'success' });

    // Process message asynchronously
    if (!data.entry) {
      return;
    }

    for (const entry of data.entry) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const messages = value.messages || [];

        for (const message of messages) {
          const fromNumber = message.from;
          const messageId = message.id;
          const messageType = message.type;

          // Only process text messages
          if (messageType !== 'text') {
            console.log(`⏭️ Skipping non-text message: ${messageType}`);
            continue;
          }

          const messageText = message.text?.body || '';
          console.log(`📱 Message from ${fromNumber}: ${messageText}`);

          // Process the message
          await processIncomingMessage(fromNumber, messageText);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error processing webhook:', error.message);
  }
});

// Process incoming WhatsApp message
async function processIncomingMessage(phoneNumber, messageText) {
  try {
    // Clean the message
    const approvalNumber = messageText.trim();

    // Check if it's an 8-digit approval number
    if (!/^\d{8}$/.test(approvalNumber)) {
      await sendHelpMessage(phoneNumber);
      return;
    }

    console.log(`🔄 Processing approval number: ${approvalNumber}`);

    // Try to process through AI pipeline (if available)
    try {
      const response = await axios.post(PROCESSING_API_URL, {
        approval_number: approvalNumber
      }, { timeout: 60000 });

      const result = response.data;

      if (result && result.ui_output_8) {
        const csMessage = result.ui_output_8;
        const overallResponse = result.overall_response || 'A';

        const formattedMessage = formatResponseMessage(
          approvalNumber,
          csMessage,
          overallResponse
        );

        await sendResponseMessage(phoneNumber, formattedMessage);
      } else {
        await sendErrorMessage(phoneNumber, 'فشل في معالجة الطلب / Failed to process request');
      }
    } catch (apiError) {
      console.log(`⚠️ Processing API not available: ${apiError.message}`);

      // Send acknowledgment message
      const ackMessage = `تم استلام رقم الموافقة: ${approvalNumber}\n\n` +
                        `سيتم معالجة طلبك قريباً.\n\n` +
                        `Approval number received: ${approvalNumber}\n` +
                        `Your request will be processed shortly.`;

      await sendResponseMessage(phoneNumber, ackMessage);
    }
  } catch (error) {
    console.error('❌ Error in processIncomingMessage:', error.message);
    await sendErrorMessage(phoneNumber, 'حدث خطأ / An error occurred');
  }
}

// Send response via Cloud Function
async function sendResponseMessage(phoneNumber, message) {
  try {
    const response = await axios.post(CLOUD_FUNCTION_URL, {
      phone_number: phoneNumber,
      message: message
    }, { timeout: 30000 });

    if (response.status === 200) {
      console.log(`✅ Response sent to ${phoneNumber}`);
    } else {
      console.error(`❌ Failed to send response: ${response.status}`);
    }
  } catch (error) {
    console.error(`❌ Error sending response: ${error.message}`);
  }
}

// Send help message for invalid input
async function sendHelpMessage(phoneNumber) {
  const message = `مرحباً! 👋

للاستعلام عن حالة الموافقة المسبقة، يرجى إرسال رقم الموافقة (8 أرقام).

مثال: 88825481

━━━━━━━━━━━━━━━━━━━━━━

Hello! 👋

To check your preauthorization status, please send your approval number (8 digits).

Example: 88825481

🤖 Tawuniya AI Assistant`;

  await sendResponseMessage(phoneNumber, message);
}

// Send error message
async function sendErrorMessage(phoneNumber, errorText) {
  const message = `⚠️ ${errorText}

يرجى المحاولة مرة أخرى أو الاتصال بخدمة العملاء.
Please try again or contact customer service.

📞 920000812`;

  await sendResponseMessage(phoneNumber, message);
}

// Format WhatsApp response message
function formatResponseMessage(approvalNumber, csMessage, overallResponse) {
  const statusEmoji = {
    'A': '✅',
    'D': '❌',
    'F': '⚠️',
    'P': '⚠️'
  };

  const emoji = statusEmoji[overallResponse] || '📋';

  return `${emoji} *نتيجة الموافقة المسبقة / Preauthorization Result*

*رقم الموافقة / Approval Number:* ${approvalNumber}

*الحالة / Status:* ${overallResponse}

━━━━━━━━━━━━━━━━━━━━━━

${csMessage}

━━━━━━━━━━━━━━━━━━━━━━

🤖 _تم المعالجة تلقائياً بواسطة الذكاء الاصطناعي_
_Processed automatically by AI_

_للمزيد من التفاصيل، يرجى مراجعة نظام MEDGO_
_For more details, please check MEDGO system_`;
}

// Start server
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ WhatsApp Webhook Server Running`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🔗 Webhook URL: https://wa-api-p2yf.onrender.com/webhook`);
  console.log(`🏥 Health Check: https://wa-api-p2yf.onrender.com/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
