import Link from "next/link";
import { GOVERNING_COUNTRY } from "@/lib/legal";
import { ContactLine, LegalLayout } from "./Legal.parts/PrivacyPage";
export { PrivacyPage } from "./Legal.parts/PrivacyPage";

export function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      intro={
        <p>
          These terms are the agreement between you and Profit Loop (“we”, “us”) when you use the app. By creating an
          account, you agree to them. We've kept them short and plain.
        </p>
      }
      sections={[
        {
          heading: "Your account",
          body: (
            <ul>
              <li>You must be 18 or over to use Profit Loop.</li>
              <li>Keep your sign-in safe. You are responsible for what happens under your account.</li>
              <li>Give us accurate details, and keep them up to date.</li>
            </ul>
          ),
        },
        {
          heading: "Your data is yours",
          body: (
            <p>
              You own everything you put into Profit Loop. You give us permission to store and process it only to run
              the service for you, as described in our{" "}
              <Link href="/privacy" className="font-medium text-[color:var(--pl-orange-text)] hover:underline">
                Privacy Policy
              </Link>
              . If you add information about your customers or team, make sure you are allowed to share it with us.
            </p>
          ),
        },
        {
          heading: "Not financial advice",
          body: (
            <p>
              Profit Loop works out figures and suggestions from what you enter. They are only as accurate as those
              records, and they are not accounting, tax, legal or investment advice. For important decisions, check
              with a qualified professional.
            </p>
          ),
        },
        {
          heading: "Fair use",
          body: (
            <>
              <p>Please don't:</p>
              <ul>
                <li>use Profit Loop for anything illegal;</li>
                <li>try to get into another person's account or records;</li>
                <li>overload, disrupt, copy or reverse-engineer the service;</li>
                <li>upload files that contain viruses or harmful code.</li>
              </ul>
            </>
          ),
        },
        {
          heading: "Connected services",
          body: (
            <p>
              When you connect another service, such as Shopify, your use of it is governed by its own terms. We aren't
              responsible for other services, their outages, or the information they send us.
            </p>
          ),
        },
        {
          heading: "Paid plans and refunds",
          body: (
            <>
              <p>
                Profit Loop is free while in beta. When paid plans launch, our order process will be conducted by our
                online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders, and handles billing
                questions and returns.
              </p>
              <p>
                You will be able to cancel a paid plan at any time and keep using it until the end of the period you
                paid for. If you are not happy, you can ask for a full refund within 14 days of a payment.
              </p>
            </>
          ),
        },
        {
          heading: "Changes to the service",
          body: (
            <p>
              Profit Loop is in beta, so features will change as we improve it. We work to keep it running and accurate,
              but we can't promise it will always be available or free of errors.
            </p>
          ),
        },
        {
          heading: "Ending your account",
          body: (
            <p>
              You can delete your account at any time from Settings → Delete account, which erases your records. We may
              suspend or close an account that breaks these terms, and will tell you why unless the law prevents it.
            </p>
          ),
        },
        {
          heading: "Our responsibility to you",
          body: (
            <p>
              Profit Loop is provided “as is”. As far as the law allows, we are not responsible for indirect losses, such
              as lost profits or lost business, and our total responsibility to you is limited to what you paid us in the
              12 months before the claim. Nothing in these terms limits rights you have under the law that cannot be
              limited.
            </p>
          ),
        },
        {
          heading: "Changes to these terms",
          body: (
            <p>
              If we change these terms, we'll update this page and the date at the top. If a change is significant,
              we'll tell you before it takes effect. Using Profit Loop after that means you accept the new terms.
            </p>
          ),
        },
        {
          heading: "The law that applies",
          body: (
            <p>
              These terms are governed by the laws of {GOVERNING_COUNTRY}, and its courts will handle any dispute that
              we can't settle together.
            </p>
          ),
        },
        {
          heading: "Contact",
          body: (
            <>
              <p>Questions about these terms are always welcome.</p>
              <ContactLine lead="Write to us at" />
            </>
          ),
        },
      ]}
    />
  );
}
