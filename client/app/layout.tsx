// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  UserButton,
  SignIn,
} from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { ClerkLoaded, ClerkLoading } from "@clerk/nextjs";

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
          colorPrimary: "#60a5fa", // tailwind blue-400
          colorText: "rgba(255,255,255,0.95)",
          colorBackground: "transparent",
          colorInputBackground: "rgba(0,0,0,0.3)",
          colorInputText: "rgba(255,255,255,0.95)",
          colorWarning: "#f59e0b",
          colorDanger: "#ef4444",
          borderRadius: "12px",
          fontFamily: "var(--font-geist-sans)",
        },
        elements: {
          // outer card (SignIn, SignUp, etc.)
          card:
            "bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl " +
            "text-white",
          headerTitle: "text-white",
          headerSubtitle: "text-white/70",
          // form bits
          formFieldLabel__text: "text-white/80",
          formFieldInput:
            "bg-black/30 border border-white/10 text-white placeholder:text-white/40 " +
            "focus:ring-2 focus:ring-blue-400/40 focus:border-white/20",
          formFieldInput__select:
            "bg-black/30 border border-white/10 text-white",
          // primary button = your blue→emerald gradient
          formButtonPrimary:
            "bg-gradient-to-r from-blue-500 to-emerald-400 text-black " +
            "hover:opacity-90 shadow-lg",
          // secondary / social buttons
          socialButtons: "gap-3",
          socialButtonsBlockButton:
            "bg-white/10 hover:bg-white/15 border border-white/10 text-white",
          // divider
          dividerLine: "bg-white/10",
          dividerText: "text-white/60",
          // footer
          footer: "text-white/60",
          footerActionText: "text-white/60",
          footerActionLink:
            "text-emerald-300 hover:text-emerald-200 transition-colors",
          // alerts
          alert: "bg-white/5 border border-white/10 text-white",
          // user avatar rings inside Clerk components
          identityPreviewAvatarBox: "ring-2 ring-white/20",
        },
      }}
    >
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-[radial-gradient(60%_80%_at_70%_-10%,rgba(59,130,246,0.25),rgba(0,0,0,0)),radial-gradient(60%_80%_at_-10%_20%,rgba(16,185,129,0.15),rgba(0,0,0,0))]`}
        >
          <SignedOut>
            <div className="min-h-screen w-full grid place-items-center p-6">
              {/* Fixed-size frame prevents layout shift */}
              <div className="w-full max-w-md">
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl">
                  <h1 className="text-2xl font-medium mb-2 text-white">
                    Welcome to DocChat
                  </h1>
                  <p className="text-white/70 mb-6">
                    Sign in to upload PDFs and chat with them.
                  </p>

                  {/* Loading state (same visual footprint as the SignIn card) */}
                  <ClerkLoading>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="h-10 w-full rounded-lg bg-white/10 animate-pulse mb-3" />
                      <div className="h-10 w-full rounded-lg bg-white/10 animate-pulse mb-3" />
                      <div className="h-12 w-full rounded-lg bg-white/10 animate-pulse" />
                    </div>
                  </ClerkLoading>

                  {/* Hydrated state */}
                  <ClerkLoaded>
                    {/* Don’t wrap SignIn in another card—let Clerk own this box */}
                    <SignIn
                      routing="hash"
                      appearance={{
                        baseTheme: undefined, // using the one set on <ClerkProvider>
                        elements: {
                          // Make the Clerk card fill the parent so size stays consistent
                          rootBox: "w-full",
                          card: "w-full bg-white/5 backdrop-blur-xl border border-white/10 shadow-xl",
                        },
                      }}
                    />
                  </ClerkLoaded>
                </div>
              </div>
            </div>
          </SignedOut>

          <SignedIn>
            <header className="sticky top-0 z-40 backdrop-blur-xl supports-[backdrop-filter]:bg-white/5 bg-black/10 border-b border-white/10">
              <nav className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue-500 to-emerald-400" />
                  <span className="text-white font-medium tracking-tight">
                    DocChat
                  </span>
                </div>
                <UserButton
                  appearance={{
                    elements: {
                      userButtonAvatarBox:
                        "ring-2 ring-white/20 hover:ring-white/30 transition-shadow",
                      userButtonPopoverCard:
                        "bg-white/5 backdrop-blur-xl border border-white/10 text-white",
                      userButtonPopoverMain: "text-white",
                      userButtonPopoverActionButton: "hover:bg-white/10",
                    },
                  }}
                />
              </nav>
            </header>
            {children}
          </SignedIn>
        </body>
      </html>
    </ClerkProvider>
  );
}
