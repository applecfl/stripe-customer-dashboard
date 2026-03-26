import { NextRequest, NextResponse } from 'next/server';
import puppeteerCore from 'puppeteer-core';

const isDev = process.env.NODE_ENV === 'development';

async function getBrowser() {
  if (isDev) {
    // Local dev: use installed Chrome
    const possiblePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    const executablePath = possiblePaths[0]; // macOS Chrome
    return puppeteerCore.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath,
      headless: true,
    });
  } else {
    // Production (Firebase App Hosting): use @sparticuz/chromium
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { html } = await request.json();

    if (!html) {
      return NextResponse.json(
        { success: false, error: 'HTML is required' },
        { status: 400 }
      );
    }

    // Clean up encoding artifacts (e.g. BOM, replacement chars) that corrupt HTML tags
    const cleanHtml = html
      .replace(/\uFFFD/g, '')  // Remove replacement characters (�)
      .replace(/\uFEFF/g, ''); // Remove BOM

    const browser = await getBrowser();

    try {
      const page = await browser.newPage();
      await page.setContent(cleanHtml, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      const pdfBase64 = Buffer.from(pdf).toString('base64');

      return NextResponse.json({ success: true, data: { pdf: pdfBase64 } });
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error('Error generating PDF:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
