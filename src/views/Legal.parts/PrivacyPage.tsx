import type { ReactNode } from "react";
import Link from "next/link";
import { TrendingUp, ArrowLeft } from "lucide-react";
import { SUPPORT_EMAIL, LEGAL_UPDATED, GOVERNING_COUNTRY } from "@/lib/legal";

/**
 * The Privacy Policy and the Terms. Reachable signed in or out, with no sidebar,
 * because a visitor deciding whether to sign up has to be able to read them.
 *
 * Written the way the rest of the app talks: plain words, short sections. Every
 * claim here is something the code does — no analytics, no ad trackers, Supabase
 * for sign-in and storage, Vercel for hosting, deletion from Settings.
 * If one of those changes, this page changes with it.
 */

export type LegalSection = { heading: string; body: ReactNode };

export function ContactLine({ lead }: { lead: string }) {
  if (!SUPPORT_EMAIL) return null;
  return (
    <p>
      {lead}{" "}
      <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-[color:var(--pl-orange-text)] hover:underline">
        {SUPPORT_EMAIL}
      </a>
      .
    </p>
  );
}

export function LegalLayout({ title, intro, sections }: { title: string; intro: ReactNode; sections: LegalSection[] }) {
  return (
    <div className="min-h-screen bg-[color:var(--pl-bg)] text-[color:var(--pl-ink)]">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--pl-orange)]">
            <TrendingUp className="h-4 w-4 text-white" strokeWidth={3} />
          </span>
          <span className="text-base font-bold">Profit Loop</span>
        </Link>
        <Link href="/" className="t-secondary inline-flex items-center gap-1.5 hover:text-[color:var(--pl-ink)]">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-20">
        <h1 className="t-title">{title}</h1>
        <p className="t-secondary mt-1">Last updated {LEGAL_UPDATED}</p>
        <div className="t-body mt-6 space-y-3 text-[color:var(--pl-ink-2)]">{intro}</div>
        {sections.map((section) => (
          <section key={section.heading} className="mt-8">
            <h2 className="t-section text-[color:var(--pl-ink)]">{section.heading}</h2>
            <div className="t-body mt-2 space-y-3 text-[color:var(--pl-ink-2)] [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
              {section.body}
            </div>
          </section>
        ))}
        <footer className="t-secondary mt-12 flex gap-4">
          <Link href="/privacy" className="hover:text-[color:var(--pl-ink)]">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-[color:var(--pl-ink)]">
            Terms of Service
          </Link>
        </footer>
      </main>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      intro={
        <p>
          Profit Loop (“we”, “us”) helps business owners see what they really make. This page explains what we
          collect, why, who helps us run the service, and how you can see or delete your information.
        </p>
      }
      sections={[
        {
          heading: "What we collect",
          body: (
            <ul>
              <li>
                <strong>Your account:</strong> your name and email address, and a profile photo if your sign-in provides
                one. Sign-in is handled by Supabase.
              </li>
              <li>
                <strong>Your business records:</strong> everything you enter or import — sales, costs, products,
                customers, team members, hours, receipts you attach and spreadsheets you upload.
              </li>
              <li>
                <strong>From a store you connect:</strong> if you connect Shopify, we bring in your orders and products,
                including each customer's name (or their email when no name is given), so you can see who bought what.
              </li>
              <li>
                <strong>Technical logs:</strong> your IP address, browser type and the pages requested, kept briefly to
                keep the service secure and working.
              </li>
            </ul>
          ),
        },
        {
          heading: "What we don't do",
          body: (
            <ul>
              <li>We don't sell your information, and we don't show you ads.</li>
              <li>We don't use advertising or analytics trackers.</li>
              <li>No other customer can see your records.</li>
            </ul>
          ),
        },
        {
          heading: "Why we use it",
          body: (
            <ul>
              <li>To run Profit Loop for you: store your records and work out your figures.</li>
              <li>To keep your account and the service secure.</li>
              <li>To answer you when you contact us.</li>
              <li>To meet our legal obligations.</li>
            </ul>
          ),
        },
        {
          heading: "Who helps us run the service",
          body: (
            <>
              <ul>
                <li>
                  <strong>Supabase</strong> — sign-in, account security and database hosting.
                </li>
                <li>
                  <strong>Vercel</strong> — hosts the app.
                </li>
                <li>
                  <strong>Shopify</strong> — only if you connect your store.
                </li>
                <li>
                  <strong>open.er-api.com</strong> — supplies exchange rates. It is only asked about currencies, never
                  sent your information.
                </li>
                <li>
                  <strong>Paddle</strong> — will process payments when paid plans launch.
                </li>
              </ul>
              <p>
                These providers may store information on servers outside {GOVERNING_COUNTRY}. They may only use it to
                provide their service to us.
              </p>
            </>
          ),
        },
        {
          heading: "Cookies and browser storage",
          body: (
            <p>
              We use one cookie to keep you signed in, and your browser's storage to remember preferences
              like light or dark mode. There are no advertising or tracking cookies.
            </p>
          ),
        },
        {
          heading: "How long we keep it",
          body: (
            <p>
              We keep your information while your account is open. When you delete your account, your records are
              erased from our database straight away; copies in our database provider's backups expire within 30 days.
              Technical logs are kept for a short time only.
            </p>
          ),
        },
        {
          heading: "Your choices",
          body: (
            <ul>
              <li>
                <strong>See and download</strong> your figures any time from Reports (Excel or PDF).
              </li>
              <li>
                <strong>Correct</strong> anything by editing it in the app.
              </li>
              <li>
                <strong>Delete your account</strong> and everything in it from Settings → Delete account. It takes
                effect immediately.
              </li>
              <li>
                <strong>Disconnect a store</strong> from Integrations whenever you like.
              </li>
            </ul>
          ),
        },
        {
          heading: "Keeping it safe",
          body: (
            <p>
              Your information is encrypted while it travels to us and while it is stored. The access keys for stores
              you connect are encrypted separately, and every request is checked so an account can only reach its own
              records.
            </p>
          ),
        },
        {
          heading: "Children",
          body: <p>Profit Loop is for people aged 18 or over, and we don't knowingly collect children's information.</p>,
        },
        {
          heading: "Changes to this policy",
          body: (
            <p>
              If we change this policy, we'll update this page and the date at the top. If a change is significant,
              we'll tell you before it takes effect.
            </p>
          ),
        },
        {
          heading: "Contact",
          body: (
            <>
              <p>Questions about your privacy, or a request about your information, are always welcome.</p>
              <ContactLine lead="Write to us at" />
            </>
          ),
        },
      ]}
    />
  );
}
