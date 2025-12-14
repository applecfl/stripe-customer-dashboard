import { NextRequest, NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';
import { ApiResponse } from '@/types';
import { getStripeAccountInfo } from '@/lib/stripe';

interface SendReminderRequest {
  customerName: string;
  customerEmail: string;
  amount: number;
  currency: string;
  failedDate: string;
  cardLast4: string | null;
  cardBrand: string | null;
  paymentLink: string;
  additionalMessage?: string;
  accountId: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<{ sent: boolean }>>> {
  try {
    const body: SendReminderRequest = await request.json();
    const {
      customerName,
      customerEmail,
      amount,
      currency,
      failedDate,
      cardLast4,
      cardBrand,
      paymentLink,
      additionalMessage,
      accountId,
    } = body;

    // Get organization name from account config
    const accountInfo = getStripeAccountInfo(accountId);
    const organizationName = accountInfo?.name || 'LEC';

    if (!customerEmail) {
      return NextResponse.json(
        { success: false, error: 'Customer email is required' },
        { status: 400 }
      );
    }

    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    if (!sendgridApiKey) {
      return NextResponse.json(
        { success: false, error: 'SendGrid API key not configured' },
        { status: 500 }
      );
    }

    // Initialize SendGrid client
    sgMail.setApiKey(sendgridApiKey);

    // Format amount for display
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);

    // Build the HTML email
    const htmlContent = `
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
              <img src="https://www.lecfl.com/wp-content/uploads/2023/01/LEC-Logo-1.png" alt="${organizationName}" style="max-width: 180px; height: auto; margin-bottom: 20px;" />
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #18181b;">Payment Reminder</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 20px 40px;">
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
                Hi ${customerName || 'there'},
              </p>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
                We noticed that your recent payment to <strong>${organizationName}</strong> was unsuccessful. We understand that payment issues can happen for various reasons, and we're here to help you resolve this quickly.
              </p>

              <!-- Payment Details Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #fafafa; border-radius: 8px; margin: 24px 0;">
                <tr>
                  <td style="padding: 24px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding: 8px 0; font-size: 14px; color: #71717a;">Failed Date</td>
                        <td align="right" style="padding: 8px 0; font-size: 14px; font-weight: 500; color: #18181b;">${failedDate}</td>
                      </tr>
                      ${cardLast4 ? `
                      <tr>
                        <td style="padding: 8px 0; font-size: 14px; color: #71717a;">Card Used</td>
                        <td align="right" style="padding: 8px 0; font-size: 14px; font-weight: 500; color: #18181b;">${cardBrand ? cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1) : 'Card'} •••• ${cardLast4}</td>
                      </tr>
                      ` : ''}
                      <tr>
                        <td style="padding: 8px 0; font-size: 14px; color: #71717a;">Amount Due</td>
                        <td align="right" style="padding: 8px 0; font-size: 20px; font-weight: 600; color: #dc2626;">${formattedAmount}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              ${additionalMessage ? `
              <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 0 8px 8px 0;">
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #1e40af;">
                  ${additionalMessage}
                </p>
              </div>
              ` : ''}

              <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
                Please click the button below to update your payment information or retry the payment with a different card.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <a href="${paymentLink}" style="display: inline-block; padding: 16px 32px; background-color: #4f46e5; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.3);">
                      Retry Payment
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
Payment Reminder

Hi ${customerName || 'there'},

We noticed that your recent payment to ${organizationName} was unsuccessful.

Failed Date: ${failedDate}
${cardLast4 ? `Card Used: ${cardBrand ? cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1) : 'Card'} •••• ${cardLast4}` : ''}
Amount Due: ${formattedAmount}

${additionalMessage ? `Note: ${additionalMessage}` : ''}

Please visit the following link to update your payment information or retry with a different card:
${paymentLink}

If you have any questions, please contact us.

Thank you,
${organizationName}
    `.trim();

    // Send via SendGrid client
    const msg = {
      to: {
        email: customerEmail,
        name: customerName || undefined,
      },
      from: {
        email: 'leconnect@lecfl.com',
        name: organizationName,
      },
      subject: `Payment Reminder - ${formattedAmount} Due`,
      text: textContent,
      html: htmlContent,
      customArgs: {
        accountId,
        failedDate,
        type: 'payment_reminder',
      },
    };

    await sgMail.send(msg);

    return NextResponse.json({
      success: true,
      data: { sent: true },
    });
  } catch (error) {
    console.error('Error sending reminder:', error);

    // Handle SendGrid specific errors
    if (error && typeof error === 'object' && 'response' in error) {
      const sgError = error as { response?: { body?: { errors?: Array<{ message: string }> } } };
      const errorMessage = sgError.response?.body?.errors?.[0]?.message || 'Failed to send email';
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to send reminder' },
      { status: 500 }
    );
  }
}
