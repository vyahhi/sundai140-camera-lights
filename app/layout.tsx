import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://you-in-light.guusuu.chatgpt.site'),
  title: 'You, In Light — Green Building Camera',
  description: 'Turn your webcam into a live 9 by 17 pixel portrait on the Green Building.',
  openGraph: {
    title: 'YOU, IN LIGHT',
    description: 'Turn your camera into building lights.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'YOU, IN LIGHT',
    description: 'Turn your camera into building lights.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
