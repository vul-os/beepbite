import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import DocsLayout from '@/components/layout/docs-layout';

const DocsPrivacyPolicy = () => {
  const templateRevised = "July 21, 2026";

  return (
    <DocsLayout title="Privacy Policy" description="Template privacy policy for self-hosted BeepBite deployments">
      <div className="max-w-4xl mx-auto">
        <Card className="border-2 border-orange-100">
          <CardContent className="p-8 space-y-8">

            {/* Header */}
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-orange-600 to-orange-500 bg-clip-text text-transparent">
                Privacy Policy
              </h1>
              <p className="text-lg text-muted-foreground">
                Template — last revised: {templateRevised}
              </p>
            </div>

            <Separator className="bg-orange-100" />

            {/* About this document */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">1. About this document</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                <strong>BeepBite is open-source, self-hosted point-of-sale software</strong> — MIT licensed,
                part of the VulOS project (<a href="https://github.com/vul-os/beepbite" className="text-orange-600 underline">github.com/vul-os/beepbite</a>).
                It is not a service run by a company on your behalf. When a restaurant deploys BeepBite, they
                install it on their own server and their own database, and everything described below happens
                on that infrastructure — not on infrastructure owned by "BeepBite" or "VulOS."
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                That means <strong>the operator running this instance — not a BeepBite company — is the data
                controller</strong> for the information described on this page. There is no central operator
                collecting data from every BeepBite deployment; each instance is independent.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                This page is a <strong>template</strong> shipped with the software so operators have a sensible
                starting point. If you are running BeepBite for your own restaurant, replace the bracketed
                placeholders below with your business's details, confirm the description of stored data still
                matches how you use the software, and adapt the wording to whatever privacy law applies to you
                (GDPR, POPIA, CCPA, or otherwise) before publishing it to your customers. This template does not
                specify a jurisdiction for you — that is your call as the operator.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Who controls this data */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">2. Who controls this data</h2>
              <p className="text-muted-foreground leading-relaxed">
                This instance of BeepBite is operated by <strong>[Your business name]</strong>, located at
                <strong> [your business address]</strong>. For privacy questions, contact
                <strong> [your privacy contact email]</strong>.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Information the software stores */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">3. Information this software stores</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                BeepBite is a full restaurant operations platform, not just a notification tool — it covers the
                POS till, kitchen display, online/marketplace ordering, table and floor management, staff
                accounts, and reporting. Depending on which features you use, your database holds:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Order data — items, quantities, prices, order status, and timestamps</li>
                <li>Customer contact details entered at checkout or via WhatsApp ordering — name, phone number, and delivery address, where your ordering flow collects them</li>
                <li>Staff and user accounts — name, email, hashed password, and role/permissions</li>
                <li>Menu, floor plan, and business configuration you enter</li>
                <li>Payment method type and last-four digits, where card processing is used (full card numbers are handled by your payment processor, never stored by the software)</li>
                <li>Reporting and analytics figures — computed from your own order history, on your own server; nothing is sent to a third-party analytics service</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                All of the above lives in the operator's own database. The software has no built-in mechanism to
                phone this data home to BeepBite, VulOS, or any other central party.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Optional integrations */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">4. Optional third-party integrations</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Out of the box, BeepBite makes no outbound network calls to any third party. A small number of
                optional integrations exist, and each one is <strong>off unless you, the operator, explicitly
                configure it with your own account and API credentials</strong>:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li><strong>WhatsApp Business API (Meta)</strong> — used only if you connect a WhatsApp Business account; sends order-status messages using your own access token. Meta's own privacy policy applies to that channel.</li>
                <li><strong>Mapping/geocoding provider</strong> — used only if you configure a maps API token, to resolve delivery addresses. Without a token configured, this feature degrades gracefully and makes no calls.</li>
                <li><strong>AI-assisted features</strong> (if you enable them) — call an AI provider using your own configured API key. No order or customer data is sent anywhere unless you turn this on.</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                If you enable any of the above, list the specific providers you've configured and update this
                section accordingly — this template intentionally does not name a fixed set of vendors, because
                which ones (if any) are active is entirely up to your deployment.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Cookies */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">5. Cookies and browser storage</h2>
              <p className="text-muted-foreground leading-relaxed">
                BeepBite does not set tracking or advertising cookies. See our{' '}
                <a href="/docs/cookies" className="text-orange-600 underline">Cookie Policy</a> for exactly what
                the application stores in your browser and why.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Retention */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">6. Data retention and deletion</h2>
              <p className="text-muted-foreground leading-relaxed">
                The software does not automatically delete or expire data — as the operator, you control how
                long records are kept and can remove them through your admin tools or directly in your database.
                Fill in your own retention practice here, e.g. how long you keep order history, and how a
                customer can ask you to delete their information.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Rights */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">7. Your customers' rights</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Depending on where your customers are located, they may have rights to access, correct, or
                delete the data you hold about them, or to object to certain processing. As the operator, you
                are responsible for honoring those requests. A starting list:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li>Access the personal data you hold about them</li>
                <li>Request correction of inaccurate information</li>
                <li>Request deletion of their data</li>
                <li>Object to or restrict certain processing</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Requests can be sent to <strong>[your privacy contact email]</strong>.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Changes */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">8. Changes to this policy</h2>
              <p className="text-muted-foreground leading-relaxed">
                This is your document once you deploy it — update it whenever your data practices or configured
                integrations change, and keep the revision date current.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* About the software */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">9. About the software</h2>
              <div className="bg-orange-50 p-4 rounded-lg space-y-2">
                <p>BeepBite is free, open-source software licensed under the MIT License.</p>
                <p><strong>Source code:</strong> <a href="https://github.com/vul-os/beepbite" className="text-orange-600 underline">github.com/vul-os/beepbite</a></p>
                <p><strong>Organization:</strong> <a href="https://github.com/vul-os" className="text-orange-600 underline">github.com/vul-os</a> (VulOS)</p>
              </div>
            </section>

          </CardContent>
        </Card>
      </div>
    </DocsLayout>
  );
};

export default DocsPrivacyPolicy;
