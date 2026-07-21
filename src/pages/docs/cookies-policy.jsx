import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import DocsLayout from '@/components/layout/docs-layout';

const DocsCookiesPolicy = () => {
  const lastUpdated = "July 2026";

  return (
    <DocsLayout title="Cookie Policy" description="What BeepBite stores in your browser, and why">
      <div className="max-w-4xl mx-auto">
        <Card className="border-2 border-orange-100">
          <CardContent className="p-8 space-y-8">

            {/* Header */}
            <div className="text-center">
              <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-orange-600 to-orange-500 bg-clip-text text-transparent">
                Cookie Policy
              </h1>
              <p className="text-lg text-muted-foreground">
                Last updated: {lastUpdated}
              </p>
            </div>

            <Separator className="bg-orange-100" />

            {/* Summary */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">1. The short version</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                BeepBite is open-source, self-hosted software — part of the VulOS project
                (<a href="https://github.com/vul-os/beepbite" className="text-orange-600 underline">github.com/vul-os/beepbite</a>).
                It sets <strong>no advertising or analytics cookies</strong> and includes no
                third-party trackers. It stores a small number of <strong>functional</strong> items in
                your browser so the app works, and <strong>nothing about them is sent to BeepBite,
                VulOS, or any other central party</strong> — there is no such party to send it to.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Strictly speaking, most of what BeepBite keeps lives in your browser's
                <em> local storage</em> rather than in cookies, but the practical point is the same:
                it stays on your device and serves the running deployment you are using.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* What is stored */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">2. What BeepBite stores, and why</h2>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
                <li><strong>Session / sign-in</strong> — keeps you logged in so you are not asked for your password on every action.</li>
                <li><strong>Active location and organisation</strong> — remembers which venue you are working in.</li>
                <li><strong>Display preferences</strong> — theme and small UI choices (for example the customer-display tip setting).</li>
                <li><strong>Kitchen-display position</strong> — remembers where a KDS station was so a refresh does not lose its place.</li>
                <li><strong>Consent choice</strong> — remembers the preference you set in the consent banner, so you are not asked again.</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                All of these are functional — the app needs them to behave correctly. None profile
                you, track you across sites, or leave your browser.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Third parties */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">3. Third-party integrations</h2>
              <p className="text-muted-foreground leading-relaxed">
                A deployment's operator may connect optional third-party services — for example a maps
                provider, or WhatsApp/Meta for messaging — using the operator's own credentials. Those
                providers have their own cookie and privacy practices, which apply when their services
                are used. BeepBite itself adds no trackers of its own.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Managing */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">4. Managing what is stored</h2>
              <p className="text-muted-foreground leading-relaxed">
                You can clear this data at any time through your browser's site-data controls. Doing so
                signs you out and resets your preferences — nothing is lost on the server beyond your
                local session. Because BeepBite sets no advertising or analytics cookies, there is
                nothing to opt out of on that front.
              </p>
            </section>

            <Separator className="bg-orange-100" />

            {/* Contact */}
            <section>
              <h2 className="text-2xl font-semibold mb-4 text-orange-800">5. Source and contact</h2>
              <div className="bg-orange-50 p-4 rounded-lg space-y-2">
                <p><strong>Project:</strong> <a href="https://github.com/vul-os/beepbite" className="text-orange-600 underline">github.com/vul-os/beepbite</a> — part of <a href="https://github.com/vul-os" className="text-orange-600 underline">VulOS</a></p>
                <p><strong>Licence:</strong> MIT</p>
                <p><strong>For a running deployment:</strong> the operator of that deployment is your point of contact.</p>
              </div>
            </section>

          </CardContent>
        </Card>
      </div>
    </DocsLayout>
  );
};

export default DocsCookiesPolicy;
