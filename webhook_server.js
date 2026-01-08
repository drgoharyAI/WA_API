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
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'wa_api_2026';
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

// Webhook verification handler
function handleVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Verification attempt:', { mode, token: token ? '***' : undefined, challenge });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed - Token mismatch');
    res.status(403).send('Verification failed');
  }
}

// Webhook verification (GET) - Support both root and /webhook paths
app.get('/', handleVerification);
app.get('/webhook', handleVerification);

// Webhook message receiver handler
async function handleIncomingWebhook(req, res) {
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
}

// Webhook message receiver (POST) - Support both root and /webhook paths
app.post('/', handleIncomingWebhook);
app.post('/webhook', handleIncomingWebhook);

// Process incoming WhatsApp message
async function processIncomingMessage(phoneNumber, messageText) {
  const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const timestamp = new Date().toISOString();

  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${timestamp}] 📥 NEW WHATSAPP REQUEST`);
    console.log(`Request ID: ${requestId}`);
    console.log(`Phone Number: ${phoneNumber}`);
    console.log(`Message: "${messageText}"`);
    console.log(`${'='.repeat(80)}\n`);

    // Clean the message
    const approvalNumber = messageText.trim();

    // Check if it's an 8-digit approval number
    if (!/^\d{8}$/.test(approvalNumber)) {
      console.log(`[${requestId}] ⚠️ Invalid format - Expected 8 digits, got: "${approvalNumber}"`);
      await sendHelpMessage(phoneNumber);
      console.log(`[${requestId}] ✅ Help message sent\n`);
      return;
    }

    console.log(`[${requestId}] ✅ Valid approval number: ${approvalNumber}`);

    // Try to process through AI pipeline
    console.log(`[${requestId}] 🔄 Initiating AI processing...`);
    console.log(`[${requestId}] 🌐 API URL: ${PROCESSING_API_URL}`);
    console.log(`[${requestId}] ⏱️ Timeout: 60 seconds`);

    try {
      const startTime = Date.now();

      // Start the API call without waiting for completion
      const apiPromise = axios.post(PROCESSING_API_URL, {
        approval_number: approvalNumber
      }, { timeout: 60000 });

      // Wait briefly to confirm the request was accepted (not failed immediately)
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log(`[${requestId}] ✅ Request successfully delivered to AI pipeline`);

      // Send acknowledgment AFTER confirming pipeline accepted the request
      const acknowledgment = `🤖 I'm AI Agent, I'll check your request and reply ASAP\n\n` +
                            `أنا وكيل الذكاء الاصطناعي، سأتحقق من طلبك وأرد في أقرب وقت\n\n` +
                            `Approval Number: ${approvalNumber}`;

      console.log(`[${requestId}] 📤 Sending acknowledgment (pipeline initiated)...`);
      await sendResponseMessage(phoneNumber, acknowledgment);
      console.log(`[${requestId}] ✅ Acknowledgment sent successfully`);

      // Now wait for the actual AI processing to complete
      console.log(`[${requestId}] ⏳ Waiting for AI processing to complete...`);
      const response = await apiPromise;
      const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`[${requestId}] ✅ AI processing completed in ${processingTime}s`);
      console.log(`[${requestId}] 📊 Response status: ${response.status}`);

      const result = response.data;

      if (result && result.ui_output_8) {
        const csMessage = result.ui_output_8;
        const overallResponse = result.overall_response || 'A';

        console.log(`[${requestId}] 📋 AI Result:`);
        console.log(`[${requestId}]    - Overall Response: ${overallResponse}`);
        console.log(`[${requestId}]    - CS Message Length: ${csMessage.length} chars`);

        const formattedMessage = formatResponseMessage(
          approvalNumber,
          csMessage,
          overallResponse
        );

        console.log(`[${requestId}] 📤 Sending final response to customer...`);
        await sendResponseMessage(phoneNumber, formattedMessage);
        console.log(`[${requestId}] ✅ Final response sent successfully`);
        console.log(`[${requestId}] 🎉 Request completed successfully in ${processingTime}s\n`);
      } else {
        console.log(`[${requestId}] ❌ Invalid AI response format - missing ui_output_8`);
        console.log(`[${requestId}] 📄 Response data:`, JSON.stringify(result, null, 2));
        await sendErrorMessage(phoneNumber, 'فشل في معالجة الطلب / Failed to process request');
        console.log(`[${requestId}] ✅ Error message sent\n`);
      }
    } catch (apiError) {
      console.log(`[${requestId}] ⚠️ AI Processing API Error:`);
      console.log(`[${requestId}]    - Error: ${apiError.message}`);
      console.log(`[${requestId}]    - Code: ${apiError.code || 'N/A'}`);

      if (apiError.response) {
        console.log(`[${requestId}]    - Status: ${apiError.response.status}`);
        console.log(`[${requestId}]    - Data:`, JSON.stringify(apiError.response.data, null, 2));
      }

      // Send fallback acknowledgment message (pipeline failed)
      const fallbackMessage = `تم استلام رقم الموافقة: ${approvalNumber}\n\n` +
                            `سيتم معالجة طلبك قريباً.\n\n` +
                            `Approval number received: ${approvalNumber}\n` +
                            `Your request will be processed shortly.`;

      console.log(`[${requestId}] 📤 Sending fallback message (pipeline unavailable)...`);
      await sendResponseMessage(phoneNumber, fallbackMessage);
      console.log(`[${requestId}] ✅ Fallback message sent\n`);
    }
  } catch (error) {
    console.error(`[${requestId}] ❌ CRITICAL ERROR in processIncomingMessage:`);
    console.error(`[${requestId}]    - Error: ${error.message}`);
    console.error(`[${requestId}]    - Stack:`, error.stack);

    await sendErrorMessage(phoneNumber, 'حدث خطأ / An error occurred');
    console.log(`[${requestId}] ✅ Error message sent\n`);
  }
}

// Send response via Cloud Function
async function sendResponseMessage(phoneNumber, message) {
  const sendTimestamp = new Date().toISOString();

  try {
    console.log(`[${sendTimestamp}] 🌐 Calling Cloud Function...`);
    console.log(`   - Target: ${phoneNumber}`);
    console.log(`   - Message Length: ${message.length} chars`);
    console.log(`   - Preview: ${message.substring(0, 100)}...`);

    const response = await axios.post(CLOUD_FUNCTION_URL, {
      phone_number: phoneNumber,
      message: message
    }, { timeout: 30000 });

    if (response.status === 200) {
      console.log(`   ✅ WhatsApp message sent successfully to ${phoneNumber}`);

      if (response.data) {
        const messageId = response.data.response?.messages?.[0]?.id;
        if (messageId) {
          console.log(`   📨 Message ID: ${messageId}`);
        }
      }
    } else {
      console.error(`   ❌ Failed to send response: ${response.status}`);
      console.error(`   📄 Response:`, JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error(`   ❌ Error sending WhatsApp message:`);
    console.error(`   - Error: ${error.message}`);
    console.error(`   - Code: ${error.code || 'N/A'}`);

    if (error.response) {
      console.error(`   - Status: ${error.response.status}`);
      console.error(`   - Data:`, JSON.stringify(error.response.data, null, 2));
    }
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
  console.log(`🔗 Webhook URL (both supported):`);
  console.log(`   - https://wa-api-p2yf.onrender.com/`);
  console.log(`   - https://wa-api-p2yf.onrender.com/webhook`);
  console.log(`🏥 Health Check: https://wa-api-p2yf.onrender.com/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
