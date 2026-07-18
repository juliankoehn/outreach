export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", maxWidth: 720, margin: "40px auto", padding: 16 }}>
        {children}
      </body>
    </html>
  );
}
