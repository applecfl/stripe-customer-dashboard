interface EmailTemplateParams {
  customerName: string;
  organizationName: string;
  logoUrl: string;
  failedDate: string;
  cardLast4: string | null;
  cardBrand: string | null;
  formattedAmount: string;
  paymentLink: string;
  additionalMessage?: string;
}

export function generatePaymentReminderHtml(params: EmailTemplateParams): string {
  const {
    customerName,
    organizationName,
    logoUrl,
    failedDate,
    cardLast4,
    cardBrand,
    formattedAmount,
    paymentLink,
    additionalMessage,
  } = params;

  return `<!DOCTYPE html>
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
</html>`;
}

export function generatePaymentReminderText(params: EmailTemplateParams): string {
  const {
    customerName,
    organizationName,
    failedDate,
    cardLast4,
    cardBrand,
    formattedAmount,
    paymentLink,
    additionalMessage,
  } = params;

  return `Payment Reminder

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
${organizationName}`;
}
