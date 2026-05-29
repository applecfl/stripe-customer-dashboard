import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { generatePaymentLinkToken } from '@/lib/auth';

interface SendTuitionStatementRequest {
  customerEmails: string[];
  subject: string;
  emailHtml?: string;
  defaultEmailBody: string;
  pdfBase64: string;
  accountId: string;
  senderName?: string;
  senderEmail?: string;
  recipientName?: string;
  // When includePayButton is true, the server mints a single-use payment_link
  // token for (customerId, invoiceUID, accountId, payAmount) and injects a
  // "Pay Now" button into the email. payAmount is in cents.
  includePayButton?: boolean;
  customerId?: string;
  invoiceUID?: string;
  payAmount?: number;
}

// Build the HTML for the Pay Now button block injected into the email.
function buildPayButton(payUrl: string, amountCents: number): string {
  const dollars = (amountCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  return `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr><td align="center" style="padding: 8px 40px 32px;">
      <a href="${payUrl}" style="display:inline-block;background-color:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 32px;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        Pay ${dollars} Now
      </a>
      <p style="margin:12px 0 0;font-size:12px;color:#a1a1aa;">Secure payment powered by Stripe. This link expires in 7 days.</p>
    </td></tr>
  </table>`;
}

// Inject the button just before </body> (fallback: append).
function injectPayButton(html: string, buttonHtml: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', `${buttonHtml}\n</body>`);
  }
  return html + buttonHtml;
}

// Resolve the public base URL for building the pay link.
function getBaseUrl(request: NextRequest): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  return `${proto}://${host}`;
}

async function sendWithGmailAPI(
  to: string[],
  from: { name: string; address: string },
  subject: string,
  textContent: string,
  htmlContent: string,
  pdfBuffer: Buffer,
  customDelegatedUser?: string
): Promise<void> {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const delegatedUser = customDelegatedUser || process.env.GMAIL_DELEGATED_USER;

  if (!serviceAccountKey || !delegatedUser) {
    throw new Error('Gmail API credentials not configured');
  }

  const credentials = JSON.parse(serviceAccountKey);

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: delegatedUser,
  });

  const gmail = google.gmail({ version: 'v1', auth });

  const boundary = '====boundary_mixed====';
  const altBoundary = '====boundary_alt====';
  const pdfBase64 = pdfBuffer.toString('base64');

  const messageParts = [
    `From: "${from.name}" <${from.address}>`,
    `To: ${to.join(', ')}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    textContent,
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    htmlContent,
    '',
    `--${altBoundary}--`,
    '',
    `--${boundary}`,
    'Content-Type: application/pdf; name="Tuition_Statement.pdf"',
    'Content-Disposition: attachment; filename="Tuition_Statement.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    pdfBase64,
    '',
    `--${boundary}--`,
  ];

  const message = messageParts.join('\r\n');

  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
    },
  });
}

async function sendWithNodemailer(
  to: string[],
  from: { name: string; address: string },
  subject: string,
  textContent: string,
  htmlContent: string,
  pdfBuffer: Buffer
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
      address: gmailUser,
    },
    to,
    subject,
    text: textContent,
    html: htmlContent,
    attachments: [
      {
        filename: 'Tuition_Statement.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

export async function POST(request: NextRequest) {
  try {
    const body: SendTuitionStatementRequest = await request.json();
    const {
      customerEmails,
      subject,
      emailHtml,
      defaultEmailBody,
      pdfBase64,
      senderName,
      senderEmail,
      recipientName,
      includePayButton,
      customerId,
      invoiceUID,
      payAmount,
      accountId,
    } = body;

    if (!customerEmails || customerEmails.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one email is required' },
        { status: 400 }
      );
    }

    if (!pdfBase64) {
      return NextResponse.json(
        { success: false, error: 'PDF is required' },
        { status: 400 }
      );
    }

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    let htmlContent = emailHtml || defaultEmailBody;

    // Optionally mint a single-use payment link (server-side, using AUTH_SECRET)
    // and inject a Pay Now button. Amount is fixed into the signed token here.
    if (includePayButton) {
      const amountCents = typeof payAmount === 'number' ? Math.round(payAmount) : NaN;
      if (!customerId || !invoiceUID || !accountId || !Number.isFinite(amountCents) || amountCents <= 0) {
        return NextResponse.json(
          { success: false, error: 'customerId, invoiceUID, accountId and a positive payAmount are required for the Pay Now button' },
          { status: 400 }
        );
      }
      const { token: payToken } = generatePaymentLinkToken(customerId, invoiceUID, accountId, amountCents);
      const payUrl = `${getBaseUrl(request)}/pay?token=${encodeURIComponent(payToken)}`;
      htmlContent = injectPayButton(htmlContent, buildPayButton(payUrl, amountCents));
    }

    const textContent = `Dear ${recipientName || 'Parent/Guardian'},\n\nAttached please find your current tuition statement.\n\nThank you,\nLEC Administration`;

    const fromEmail = senderEmail || process.env.GMAIL_DELEGATED_USER || process.env.GMAIL_USER || 'noreply@lecfl.com';
    const fromName = senderName || 'LEC Administration';

    const from = { name: fromName, address: fromEmail };

    const useServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_KEY && (senderEmail || process.env.GMAIL_DELEGATED_USER);

    if (useServiceAccount) {
      await sendWithGmailAPI(customerEmails, from, subject, textContent, htmlContent, pdfBuffer, senderEmail);
    } else {
      await sendWithNodemailer(customerEmails, from, subject, textContent, htmlContent, pdfBuffer);
    }

    return NextResponse.json({ success: true, data: { sent: true } });
  } catch (error) {
    console.error('Error sending tuition statement:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to send tuition statement' },
      { status: 500 }
    );
  }
}
