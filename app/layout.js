import './globals.css';

export const metadata = {
  title: 'RobinAGNT — Robinhood Chain dashboard',
  description: 'Wallets, tokens & volume on Robinhood Chain (4663). Open API. Built on AGNT.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
