import { NextRequest, NextResponse } from 'next/server';

const GOTENBERG_URL = process.env.GOTENBERG_URL || 'http://localhost:3000';

export async function POST(request: NextRequest) {
  try {
    const { html } = await request.json();

    if (!html) {
      return NextResponse.json(
        { success: false, error: 'HTML is required' },
        { status: 400 }
      );
    }

    // Clean up encoding artifacts
    const cleanHtml = html
      .replace(/\uFFFD/g, '')
      .replace(/\uFEFF/g, '');

    // Call Gotenberg's HTML to PDF endpoint
    const formData = new FormData();
    const htmlBlob = new Blob([cleanHtml], { type: 'text/html' });
    formData.append('files', htmlBlob, 'index.html');
    formData.append('paperWidth', '8.27');  // A4
    formData.append('paperHeight', '11.7'); // A4
    formData.append('printBackground', 'true');

    const response = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gotenberg error: ${response.status} ${errorText}`);
    }

    const pdfBuffer = await response.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

    return NextResponse.json({ success: true, data: { pdf: pdfBase64 } });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
