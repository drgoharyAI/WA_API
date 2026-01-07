"""
WhatsApp Webhook Handler for Render.com
Receives incoming WhatsApp messages and processes them through AI pipeline
"""

import os
import requests
import logging
from flask import Flask, request, jsonify
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.whatsapp')

# Configuration
WHATSAPP_VERIFY_TOKEN = os.getenv('WHATSAPP_VERIFY_TOKEN', 'wa_api_2026')
CLOUD_FUNCTION_URL = 'https://whatsapp-proxy-66mhuvutfa-uc.a.run.app'
PROCESSING_API_URL = os.getenv('PROCESSING_API_URL', 'http://localhost:5000/api/process-approval')

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)


@app.route('/webhook', methods=['GET'])
def verify_webhook():
    """
    Webhook verification endpoint for Meta
    Meta will call this to verify your webhook URL
    """
    mode = request.args.get('hub.mode')
    token = request.args.get('hub.verify_token')
    challenge = request.args.get('hub.challenge')

    if mode == 'subscribe' and token == WHATSAPP_VERIFY_TOKEN:
        logger.info("Webhook verified successfully!")
        return challenge, 200
    else:
        logger.warning("Webhook verification failed")
        return 'Verification failed', 403


@app.route('/webhook', methods=['POST'])
def receive_message():
    """
    Receive incoming WhatsApp messages from Meta
    """
    try:
        data = request.json
        logger.info(f"Received webhook data: {data}")

        # Extract message data
        if not data.get('entry'):
            return jsonify({'status': 'no entry'}), 200

        for entry in data['entry']:
            for change in entry.get('changes', []):
                value = change.get('value', {})

                # Check if this is a message
                messages = value.get('messages', [])
                if not messages:
                    continue

                for message in messages:
                    # Extract message details
                    from_number = message.get('from')
                    message_id = message.get('id')
                    message_type = message.get('type')
                    timestamp = message.get('timestamp')

                    # Only process text messages
                    if message_type != 'text':
                        logger.info(f"Skipping non-text message type: {message_type}")
                        continue

                    message_text = message.get('text', {}).get('body', '')
                    logger.info(f"Received message from {from_number}: {message_text}")

                    # Process the message
                    process_incoming_message(from_number, message_text)

        return jsonify({'status': 'success'}), 200

    except Exception as e:
        logger.error(f"Error processing webhook: {str(e)}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


def process_incoming_message(phone_number, message_text):
    """
    Process incoming WhatsApp message

    Expected format: "88825481" (8-digit approval number)
    """
    try:
        # Clean the message
        approval_number = message_text.strip()

        # Check if it's an 8-digit approval number
        if not approval_number.isdigit() or len(approval_number) != 8:
            # Send help message
            send_help_message(phone_number)
            return

        logger.info(f"Processing approval number: {approval_number}")

        # Process through AI pipeline
        try:
            response = requests.post(
                PROCESSING_API_URL,
                json={'approval_number': approval_number},
                timeout=60
            )

            if response.status_code != 200:
                send_error_message(phone_number, "فشل في معالجة الطلب / Failed to process request")
                return

            result = response.json()

        except Exception as e:
            logger.error(f"Error calling processing API: {str(e)}")
            # If processing API is not available, send a message
            send_response_message(
                phone_number,
                f"تم استلام رقم الموافقة: {approval_number}\n\n"
                f"سيتم معالجة طلبك قريباً.\n\n"
                f"Approval number received: {approval_number}\n"
                f"Your request will be processed shortly."
            )
            return

        # Format and send response
        if result and result.get('ui_output_8'):
            cs_message = result['ui_output_8']
            overall_response = result.get('overall_response', 'A')

            formatted_message = format_response_message(
                approval_number,
                cs_message,
                overall_response
            )

            send_response_message(phone_number, formatted_message)
        else:
            send_error_message(phone_number, "فشل في معالجة الطلب / Failed to process request")

    except Exception as e:
        logger.error(f"Error in process_incoming_message: {str(e)}")
        send_error_message(phone_number, "حدث خطأ / An error occurred")


def send_response_message(phone_number, message):
    """Send response via Cloud Function"""
    try:
        payload = {
            'phone_number': phone_number,
            'message': message
        }

        response = requests.post(
            CLOUD_FUNCTION_URL,
            json=payload,
            timeout=30
        )

        if response.status_code == 200:
            logger.info(f"Response sent to {phone_number}")
        else:
            logger.error(f"Failed to send response: {response.status_code}")

    except Exception as e:
        logger.error(f"Error sending response: {str(e)}")


def send_help_message(phone_number):
    """Send help message for invalid input"""
    message = """مرحباً! 👋

للاستعلام عن حالة الموافقة المسبقة، يرجى إرسال رقم الموافقة (8 أرقام).

مثال: 88825481

━━━━━━━━━━━━━━━━━━━━━━

Hello! 👋

To check your preauthorization status, please send your approval number (8 digits).

Example: 88825481

🤖 Tawuniya AI Assistant"""

    send_response_message(phone_number, message)


def send_error_message(phone_number, error_text):
    """Send error message"""
    message = f"""⚠️ {error_text}

يرجى المحاولة مرة أخرى أو الاتصال بخدمة العملاء.
Please try again or contact customer service.

📞 920000812"""

    send_response_message(phone_number, message)


def format_response_message(approval_number, cs_message, overall_response):
    """Format the WhatsApp response message"""
    status_emoji = {
        'A': '✅',
        'D': '❌',
        'F': '⚠️',
        'P': '⚠️'
    }

    emoji = status_emoji.get(overall_response, '📋')

    return f"""{emoji} *نتيجة الموافقة المسبقة / Preauthorization Result*

*رقم الموافقة / Approval Number:* {approval_number}

*الحالة / Status:* {overall_response}

━━━━━━━━━━━━━━━━━━━━━━

{cs_message}

━━━━━━━━━━━━━━━━━━━━━━

🤖 _تم المعالجة تلقائياً بواسطة الذكاء الاصطناعي_
_Processed automatically by AI_

_للمزيد من التفاصيل، يرجى مراجعة نظام MEDGO_
_For more details, please check MEDGO system_"""


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'whatsapp-webhook',
        'cloud_function': CLOUD_FUNCTION_URL
    }), 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    logger.info(f"Starting WhatsApp Webhook Handler on port {port}")
    logger.info(f"Webhook URL: https://wa-api-p2yf.onrender.com/webhook")
    logger.info(f"Verify Token: {WHATSAPP_VERIFY_TOKEN}")
    app.run(host='0.0.0.0', port=port)
