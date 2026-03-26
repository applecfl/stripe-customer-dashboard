import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';

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

    const htmlContent = emailHtml || defaultEmailBody;
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
