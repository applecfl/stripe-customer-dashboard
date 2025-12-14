'use client';

import { AlertTriangle } from 'lucide-react';

export default function ExpiredPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 max-w-md w-full text-center">
        <div className="mb-6">
          <img
            src="https://lecfl.com/wp-content/uploads/2024/08/LEC-Logo-Primary-1.png"
            alt="LEC Logo"
            className="h-10 mx-auto"
          />
        </div>
        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-3">
          Session Expired
        </h1>
        <p className="text-gray-600 leading-relaxed">
          Your session has expired. Please return to the LEC system and try again.
        </p>
      </div>
    </div>
  );
}
