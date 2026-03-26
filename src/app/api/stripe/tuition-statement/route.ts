import { NextRequest, NextResponse } from 'next/server';
import { runServerCommand } from '@/lib/server-command';

export async function POST(request: NextRequest) {
  try {
    const { invoiceUID } = await request.json();

    if (!invoiceUID) {
      return NextResponse.json(
        { success: false, error: 'invoiceUID is required' },
        { status: 400 }
      );
    }

    const html = await runServerCommand(
      JSON.stringify({ 'InvoiceUID': invoiceUID }),
      'CreateTuitionStatement'
    );

    return NextResponse.json({ success: true, data: { html } });
  } catch (error) {
    console.error('Error creating tuition statement:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create tuition statement' },
      { status: 500 }
    );
  }
}
