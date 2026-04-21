import '../styles/globals.css';
import { AppProvider } from './providers/AppProvider';

export const metadata = {
  title: 'Scleral PPG - Scleral Photoplethysmography',
  description: 'Non-contact heart rate monitoring using scleral photoplethysmography',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
