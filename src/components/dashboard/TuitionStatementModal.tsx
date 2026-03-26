'use client';

import { useState, useEffect, useRef } from 'react';
import { CustomerData, ExtendedCustomerInfo, InvoiceData } from '@/types';
import { Modal, ModalFooter, Button } from '@/components/ui';
import { Send, AlertCircle, CheckCircle, X, RotateCcw, Bold, Italic, Link, List, Plus, Loader2, Paperclip, Eye } from 'lucide-react';

interface TuitionStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceUID: string;
  token: string;
  customer: CustomerData | null;
  extendedInfo?: ExtendedCustomerInfo;
  invoices: InvoiceData[];
  accountId: string;
}

export function TuitionStatementModal({
  isOpen,
  onClose,
  invoiceUID,
  token,
  customer,
  extendedInfo,
  invoices,
  accountId,
}: TuitionStatementModalProps) {
  const [loading, setLoading] = useState(false);
  const [fetchingStatement, setFetchingStatement] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [subject, setSubject] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [statementHtml, setStatementHtml] = useState('');
  const [pdfBase64, setPdfBase64] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const parentsName = extendedInfo?.parentsName || customer?.name || '';
  const description = extendedInfo?.paymentName || '';
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Replace {{double brace}} tags in server-returned HTML with token data
  const replaceTags = (html: string): string => {
    const tagMap: Record<string, string> = {
      'ParentsName': parentsName,
      'FatherName': extendedInfo?.fatherName || '',
      'MotherName': extendedInfo?.motherName || '',
      'Description': description,
      'Date': today,
      'Amount': extendedInfo?.totalAmount ? `$${(extendedInfo.totalAmount / 100).toFixed(2)}` : '',
      'PaymentName': extendedInfo?.paymentName || '',
      'CustomerName': customer?.name || '',
      'SenderName': extendedInfo?.senderName || '',
    };

    return html.replace(/\{\{(\w+)\}\}/g, (match, tag) => {
      return tagMap[tag] ?? match;
    });
  };

  const defaultSubject = `Tuition Statement - ${description || 'Current Statement'}`;

  const logoUrl = 'https://lecfl.com/wp-content/uploads/2024/08/LEC-Logo-Primary-1.png';

  const defaultEmailBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header with Logo -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center;">
              <img src="${logoUrl}" alt="LEC" style="max-width: 180px; height: auto; margin-bottom: 20px;" />
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #18181b;">Tuition Statement</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 20px 40px;">
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
                Dear ${parentsName},
              </p>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
                Attached please find your current statement for ${description} as of ${today}.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px 40px;">
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 0 0 20px;">
              <p style="margin: 0 0 10px; font-size: 14px; color: #71717a;">
                Thank you,
              </p>
              <p style="margin: 0; font-size: 14px; font-weight: 600; color: #3f3f46;">
                LEC Administration
              </p>
              <p style="margin: 20px 0 0; font-size: 12px; color: #a1a1aa; text-align: center;">
                LEC
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

  // Get recipient name
  const getRecipientName = (): string => {
    if (extendedInfo?.parentsName) return extendedInfo.parentsName;
    const names: string[] = [];
    if (extendedInfo?.fatherName) names.push(extendedInfo.fatherName);
    if (extendedInfo?.motherName) names.push(extendedInfo.motherName);
    if (names.length > 0) return names.join(' and ');
    return customer?.name || '';
  };

  // Collect initial emails
  const getInitialEmails = (): string[] => {
    const emailSet = new Set<string>();
    if (customer?.email) emailSet.add(customer.email);
    if (extendedInfo?.fatherEmail) emailSet.add(extendedInfo.fatherEmail);
    if (extendedInfo?.motherEmail) emailSet.add(extendedInfo.motherEmail);
    return Array.from(emailSet);
  };

  // Fetch statement HTML and initialize when modal opens
  useEffect(() => {
    if (!isOpen || !invoiceUID) return;

    setSubject(defaultSubject);
    setEmails(getInitialEmails());
    setNewEmail('');
    setHasChanges(false);
    setSuccess(false);
    setError('');
    setStatementHtml('');
    setPdfBase64('');

    // Fetch statement HTML from server, replace tags, then generate PDF
    setFetchingStatement(true);
    fetch(`/api/stripe/tuition-statement?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceUID }),
    })
      .then(res => res.json())
      .then(async (result) => {
        if (result.success) {
          const processedHtml = replaceTags(result.data.html);
          setStatementHtml(processedHtml);

          // Generate PDF from the processed HTML
          const pdfRes = await fetch(`/api/stripe/generate-pdf?token=${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: processedHtml }),
          });
          const pdfResult = await pdfRes.json();
          if (pdfResult.success) {
            setPdfBase64(pdfResult.data.pdf);
          }
        }
      })
      .catch(() => {
        // Statement fetch failed - user can still send email without it
      })
      .finally(() => {
        setFetchingStatement(false);
      });
  }, [isOpen, invoiceUID]);

  // Setup editable iframe with email body
  useEffect(() => {
    if (isOpen && iframeRef.current) {
      const iframe = iframeRef.current;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(defaultEmailBody);
        doc.close();
        doc.body.contentEditable = 'true';
        doc.body.style.outline = 'none';
        doc.body.addEventListener('input', () => {
          setHasChanges(true);
        });
      }
    }
  }, [isOpen, defaultEmailBody]);

  const handleSubjectChange = (value: string) => {
    setSubject(value);
    setHasChanges(value !== defaultSubject);
  };

  const handleReset = () => {
    setSubject(defaultSubject);
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(defaultEmailBody);
        doc.close();
        doc.body.contentEditable = 'true';
        doc.body.style.outline = 'none';
        doc.body.addEventListener('input', () => {
          setHasChanges(true);
        });
      }
    }
    setHasChanges(false);
  };

  // WYSIWYG commands
  const execCommand = (command: string, value?: string) => {
    const iframe = iframeRef.current;
    if (iframe) {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.execCommand(command, false, value);
        iframe.contentWindow?.focus();
        setHasChanges(true);
      }
    }
  };

  const handleBold = () => execCommand('bold');
  const handleItalic = () => execCommand('italic');
  const handleLink = () => {
    const url = prompt('Enter URL:');
    if (url) execCommand('createLink', url);
  };
  const handleList = () => execCommand('insertUnorderedList');

  // Email management
  const addEmail = () => {
    const email = newEmail.trim().toLowerCase();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !emails.includes(email)) {
      setEmails([...emails, email]);
      setNewEmail('');
    }
  };

  const removeEmail = (emailToRemove: string) => {
    setEmails(emails.filter(e => e !== emailToRemove));
  };

  const handleEmailKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEmail();
    }
  };

  const getEmailHtml = (): string => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
      if (doc) {
        return '<!DOCTYPE html><html>' + doc.documentElement.innerHTML + '</html>';
      }
    }
    return defaultEmailBody;
  };

  const handleSend = async () => {
    if (emails.length === 0) {
      setError('Please add at least one email address');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const emailHtml = getEmailHtml();
      const response = await fetch(`/api/stripe/send-tuition-statement?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerEmails: emails,
          subject,
          emailHtml: hasChanges ? emailHtml : undefined,
          defaultEmailBody,
          pdfBase64,
          accountId,
          senderName: extendedInfo?.senderName,
          senderEmail: extendedInfo?.senderEmail,
          recipientName: getRecipientName(),
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to send tuition statement');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send tuition statement');
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewPdf = () => {
    if (!pdfBase64) return;
    const byteCharacters = atob(pdfBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const handleClose = () => {
    setError('');
    setSuccess(false);
    setSubject('');
    setHasChanges(false);
    setStatementHtml('');
    setPdfBase64('');
    onClose();
  };

  // Success state
  if (success) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title="Statement Sent" size="sm">
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Tuition Statement Sent!</h3>
          <p className="text-gray-600 text-sm">
            The tuition statement has been sent to{' '}
            <span className="font-medium">{emails.length} recipient{emails.length !== 1 ? 's' : ''}</span>
          </p>
        </div>
        <ModalFooter>
          <Button onClick={handleClose}>
            Done
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Send Tuition Statement"
      size="full"
    >
      <div className="flex flex-col h-[calc(100vh-200px)] min-h-[500px]">
        {/* Email Header - From, To, Subject */}
        <div className="border-b border-gray-200 pb-4 mb-4 space-y-3">
          {/* From Field */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-500 w-16">From:</label>
            <div className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
              {extendedInfo?.senderName && extendedInfo?.senderEmail ? (
                <span>
                  <span className="font-medium">{extendedInfo.senderName}</span>
                  <span className="text-gray-500 ml-1">&lt;{extendedInfo.senderEmail}&gt;</span>
                </span>
              ) : extendedInfo?.senderEmail ? (
                <span>{extendedInfo.senderEmail}</span>
              ) : (
                <span className="text-gray-400">Default sender (admin@lecfl.com)</span>
              )}
            </div>
          </div>

          {/* To Field */}
          <div className="flex items-start gap-3">
            <label className="text-sm font-medium text-gray-500 w-16 pt-2">To:</label>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2 p-2 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent min-h-[42px]">
                {emails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm"
                  >
                    {email}
                    <button
                      type="button"
                      onClick={() => removeEmail(email)}
                      className="hover:bg-indigo-200 rounded-full p-0.5 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1 flex-1 min-w-[200px]">
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={handleEmailKeyDown}
                    className="flex-1 outline-none text-sm py-1 min-w-[150px]"
                    placeholder={emails.length === 0 ? "Add email address..." : "Add another email..."}
                  />
                  <button
                    type="button"
                    onClick={addEmail}
                    disabled={!newEmail.trim()}
                    className="p-1 text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Add email"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">Press Enter or click + to add an email</p>
            </div>
          </div>

          {/* Subject Field */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-500 w-16">Subject:</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => handleSubjectChange(e.target.value)}
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="Email subject..."
            />
          </div>

          {/* Attachment indicator */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-500 w-16">Attach:</label>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700">
              <Paperclip className="w-3.5 h-3.5" />
              {fetchingStatement ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Generating PDF...
                </span>
              ) : pdfBase64 ? (
                <span>Tuition_Statement.pdf</span>
              ) : (
                <span className="text-purple-400">No statement available</span>
              )}
            </div>
            {pdfBase64 && !fetchingStatement && (
              <button
                type="button"
                onClick={handlePreviewPdf}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-sm text-indigo-700 hover:bg-indigo-100 transition-colors"
                title="Preview statement in new tab"
              >
                <Eye className="w-3.5 h-3.5" />
                Preview
              </button>
            )}
          </div>
        </div>

        {/* WYSIWYG Toolbar */}
        <div className="flex items-center gap-1 pb-2 border-b border-gray-200 mb-2">
          <button type="button" onClick={handleBold} className="p-2 hover:bg-gray-100 rounded transition-colors" title="Bold">
            <Bold className="w-4 h-4 text-gray-600" />
          </button>
          <button type="button" onClick={handleItalic} className="p-2 hover:bg-gray-100 rounded transition-colors" title="Italic">
            <Italic className="w-4 h-4 text-gray-600" />
          </button>
          <button type="button" onClick={handleLink} className="p-2 hover:bg-gray-100 rounded transition-colors" title="Insert Link">
            <Link className="w-4 h-4 text-gray-600" />
          </button>
          <button type="button" onClick={handleList} className="p-2 hover:bg-gray-100 rounded transition-colors" title="Bullet List">
            <List className="w-4 h-4 text-gray-600" />
          </button>
          <div className="flex-1" />
          {hasChanges && (
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-700 hover:text-amber-800 hover:bg-amber-50 rounded transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to Default
            </button>
          )}
        </div>

        {/* Email Body - Editable iframe */}
        <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden bg-gray-100">
          <iframe
            ref={iframeRef}
            title="Email Editor"
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-scripts"
          />
        </div>

        {/* No Email Warning */}
        {emails.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700">
              Please add at least one email address to send the statement.
            </p>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 overflow-hidden">
            <div className="bg-red-50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <h3 className="font-semibold text-red-900">Failed to Send</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setError('')}
                  className="text-red-400 hover:text-red-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-700">{error}</p>
            </div>
            <div className="px-4 pb-4 flex gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setError('')}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      <ModalFooter>
        <Button variant="secondary" onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSend} loading={loading} disabled={emails.length === 0 || fetchingStatement || !pdfBase64}>
          <Send className="w-4 h-4" />
          Send Statement
        </Button>
      </ModalFooter>
    </Modal>
  );
}
