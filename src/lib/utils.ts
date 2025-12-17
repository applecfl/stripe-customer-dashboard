import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export function formatDate(timestamp: number | null): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp * 1000));
}

// Compact date format: "12/17/24" style
export function formatDateCompact(timestamp: number | null): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('en-US', {
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(timestamp * 1000));
}

export function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    // Invoice statuses
    draft: 'bg-gray-100 text-gray-700',
    open: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700',
    void: 'bg-gray-100 text-gray-700',
    uncollectible: 'bg-red-100 text-red-700',
    // Payment statuses
    succeeded: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    failed: 'bg-red-100 text-red-700',
    canceled: 'bg-gray-100 text-gray-700',
    requires_payment_method: 'bg-orange-100 text-orange-700',
    requires_confirmation: 'bg-orange-100 text-orange-700',
    requires_action: 'bg-orange-100 text-orange-700',
    processing: 'bg-blue-100 text-blue-700',
    // Custom statuses
    paused: 'bg-purple-100 text-purple-700',
    refunded: 'bg-indigo-100 text-indigo-700',
    partial: 'bg-amber-100 text-amber-700',
  };
  return colors[status] || 'bg-gray-100 text-gray-700';
}
