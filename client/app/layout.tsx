// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ClerkProvider, ClerkLoaded, ClerkLoading } from "@clerk/nextjs";
import { dark } from "@clerk/themes";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DocChat — Chat with your PDFs",
  description: "Upload PDFs, pick one, and chat with an AI assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: "#34d399",
          colorText: "rgba(255,255,255,0.95)",
          colorBackground: "#0f1117",
          colorInputBackground: "rgba(255,255,255,0.06)",
          colorInputText: "rgba(255,255,255,0.95)",
          colorWarning: "#fbbf24",
          colorDanger: "#f87171",
          borderRadius: "0.75rem",
          fontFamily: "var(--font-geist-sans)",
        },
      }}
    >
      <html lang="en" suppressHydrationWarning>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-[radial-gradient(60%_80%_at_70%_-10%,rgba(59,130,246,0.25),rgba(0,0,0,0)),radial-gradient(60%_80%_at_-10%_20%,rgba(16,185,129,0.15),rgba(0,0,0,0))]`}
        >
          {/* While Clerk bootstraps, render nothing visible to avoid SignIn skeleton flash */}
          <ClerkLoading>
            {/* Keep layout height stable to prevent jumps */}
            <div className="min-h-screen opacity-0 pointer-events-none select-none" />
          </ClerkLoading>

          {/* Only render the app once Clerk is fully loaded */}
          <ClerkLoaded>{children}</ClerkLoaded>
        </body>
      </html>
    </ClerkProvider>
  );
}
