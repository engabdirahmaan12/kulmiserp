import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';

const EXTENSION_CLEANUP_SCRIPT = `
(function () {
  var ATTRS = ['bis_skin_checked', 'bis_register', '__processed_by_bitdefender'];
  function strip() {
    try {
      document.querySelectorAll('*').forEach(function (el) {
        for (var i = 0; i < ATTRS.length; i++) {
          if (el.hasAttribute(ATTRS[i])) el.removeAttribute(ATTRS[i]);
        }
      });
    } catch (e) {}
  }
  strip();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', strip);
  }
  try {
    var observer = new MutationObserver(function () { strip(); });
    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ATTRS,
    });
    setTimeout(function () { observer.disconnect(); }, 5000);
  } catch (e) {}
})();
`;

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'KULMIS ERP — Somali Business Management Platform',
    template: '%s | KULMIS ERP',
  },
  description: 'KULMIS ERP is a modern multi-tenant ERP & POS platform built for Somali and African businesses. Manage inventory, accounting, sales, and customers in one place.',
  applicationName: 'KULMIS ERP',
  keywords: ['ERP', 'POS', 'Somalia', 'inventory', 'accounting', 'business', 'cashier', 'invoices', 'WAAFI', 'EVC Plus', 'Somali business software'],
  authors: [{ name: 'KULMIS Team' }],
  robots: { index: true, follow: true },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'KULMIS ERP',
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: 'website',
    siteName: 'KULMIS ERP',
    title: 'KULMIS ERP — Modern ERP & POS for African Businesses',
    description: 'Manage your entire business: inventory, POS, accounting, customers, and more.',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'KULMIS ERP',
    description: 'Modern ERP & POS platform for Somali and African businesses',
  },
};

export const viewport: Viewport = {
  themeColor: '#2563EB',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        <Script id="extension-attribute-cleanup" strategy="beforeInteractive">
          {EXTENSION_CLEANUP_SCRIPT}
        </Script>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
