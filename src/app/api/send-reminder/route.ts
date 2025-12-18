import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { ApiResponse } from '@/types';
import { getStripeAccountInfo } from '@/lib/stripe';

interface SendReminderRequest {
  customerName: string;
  customerEmails: string[];
  amount: number;
  currency: string;
  dueDate: string;
  cardLast4: string | null;
  cardBrand: string | null;
  paymentLink: string;
  additionalMessage?: string;
  accountId: string;
  customHtml?: string;
  customSubject?: string;
  // Custom sender info from JSON
  senderName?: string;
  senderEmail?: string;
}

// Send email using Gmail API with Service Account
async function sendWithGmailAPI(
  to: string[],
  from: { name: string; address: string },
  subject: string,
  text: string,
  html: string,
  customDelegatedUser?: string // Optional: override the default delegated user
): Promise<void> {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  // Use custom delegated user if provided (from Sender.Email in JSON), otherwise use env var
  const delegatedUser = customDelegatedUser || process.env.GMAIL_DELEGATED_USER;

  if (!serviceAccountKey || !delegatedUser) {
    throw new Error('Gmail API credentials not configured');
  }

  // Parse the service account key (stored as JSON string in env)
  const credentials = JSON.parse(serviceAccountKey);

  // Create JWT auth client with domain-wide delegation
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: delegatedUser, // Impersonate this user
  });

  const gmail = google.gmail({ version: 'v1', auth });

  // Build the email message in RFC 2822 format
  const boundary = '====boundary====';
  const messageParts = [
    `From: "${from.name}" <${from.address}>`,
    `To: ${to.join(', ')}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
    '',
    `--${boundary}--`,
  ];

  const message = messageParts.join('\r\n');

  // Encode to base64url
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Send the email
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
    },
  });
}

// Send email using Nodemailer with Gmail SMTP (app password)
async function sendWithNodemailer(
  to: string[],
  from: { name: string; address: string },
  subject: string,
  text: string,
  html: string
): Promise<void> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailAppPassword) {
    throw new Error('Gmail SMTP credentials not configured');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
  });

  await transporter.sendMail({
    from: {
      name: from.name,
      address: gmailUser, // Must use authenticated user for SMTP
    },
    to,
    subject,
    text,
    html,
  });
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<{ sent: boolean }>>> {
  try {
    const body: SendReminderRequest = await request.json();
    const {
      customerName,
      customerEmails,
      amount,
      currency,
      dueDate,
      cardLast4,
      cardBrand,
      paymentLink,
      additionalMessage,
      accountId,
      customHtml,
      customSubject,
      senderName,
      senderEmail,
    } = body;

    // Get organization name from account config
    const accountInfo = getStripeAccountInfo(accountId);
    const organizationName = accountInfo?.name || 'LEC';
    const logoUrl = 'https://lecfl.com/wp-content/uploads/2024/08/LEC-Logo-Primary-1.png';

    if (!customerEmails || customerEmails.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one customer email is required' },
        { status: 400 }
      );
    }

    // Format amount for display
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);

    // Build the HTML email - use customHtml if provided, otherwise use default template
    const htmlContent = customHtml || `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Reminder</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header with Logo -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center;">
              <img src="${logoUrl}" alt="${organizationName}" style="max-width: 180px; height: auto; margin-bottom: 20px;" />
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #18181b;">Payment Reminder - Due ${dueDate}</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 20px 40px;">
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
                Hi ${customerName || 'there'},
              </p>
              <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
                We noticed that your recent tuition payment to LEC was unsuccessful. We understand that payment issues can happen for various reasons. Please use the link below to make a payment or reply to this email to contact the registration department for further assistance.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <a href="${paymentLink}" style="display: inline-block; padding: 16px 32px; background-color: #4f46e5; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.3);">
                      Make a Payment
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px 40px;">
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 0 0 20px;">
              <p style="margin: 0 0 10px; font-size: 14px; color: #71717a; text-align: center;">
                If you have any questions or need assistance, please don't hesitate to contact us.
              </p>
              <p style="margin: 0; font-size: 14px; color: #71717a; text-align: center;">
                Thank you for your attention to this matter.
              </p>
              <p style="margin: 20px 0 0; font-size: 12px; color: #a1a1aa; text-align: center;">
                ${organizationName}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    // Plain text version
    const textContent = `
Payment Reminder - Due ${dueDate}

Hi ${customerName || 'there'},

We noticed that your recent tuition payment to LEC was unsuccessful. We understand that payment issues can happen for various reasons. Please use the link below to make a payment or reply to this email to contact the registration department for further assistance.

Make a Payment: ${paymentLink}

Thank you,
${organizationName}
    `.trim();

    const subject = customSubject || `Payment Reminder - ${formattedAmount} Due`;

    // Use custom sender from JSON if provided, otherwise fall back to env vars
    const fromEmail = senderEmail || process.env.GMAIL_DELEGATED_USER || process.env.GMAIL_USER || 'noreply@lecfl.com';
    const fromName = senderName || organizationName;

    const from = {
      name: fromName,
      address: fromEmail,
    };

    // Try Gmail API with Service Account first, fall back to Nodemailer
    const useServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_KEY && (senderEmail || process.env.GMAIL_DELEGATED_USER);

    if (useServiceAccount) {
      // For service account, use the senderEmail as the delegated user to impersonate
      await sendWithGmailAPI(customerEmails, from, subject, textContent, htmlContent, senderEmail);
    } else {
      await sendWithNodemailer(customerEmails, from, subject, textContent, htmlContent);
    }

    return NextResponse.json({
      success: true,
      data: { sent: true },
    });
  } catch (error) {
    console.error('Error sending reminder:', error);

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to send reminder' },
      { status: 500 }
    );
  }
}
