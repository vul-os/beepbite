import React from 'react';
import { useLocation } from 'react-router-dom';
import DocsLayout, { usePrevNext } from '@/components/layout/docs-layout';
import {
  PageHeader,
  Section,
  Steps,
  Step,
  Screenshot,
  Callout,
  PrevNext,
  KeyValueList,
} from '@/components/docs/docs-primitives';

const POSOverview = () => {
  const { pathname } = useLocation();
  const { prev, next } = usePrevNext(pathname);

  return (
    <DocsLayout title="POS overview" description="Take counter orders, manage the live queue, settle payments.">
      <PageHeader
        eyebrow="Restaurant Operations"
        title="POS overview"
        description="The point-of-sale is your main service surface. Use it to take in-store orders, process payments, and watch WhatsApp orders come in alongside walk-ins."
        readTime="8 min"
        lastUpdated="2026-04-22"
      />

      <KeyValueList
        items={[
          { label: 'Where to find it', value: 'Top nav → Home, or app.beepbite.io/home' },
          { label: 'Permissions', value: 'Anyone with the Cashier or Manager role' },
          { label: 'Hardware', value: 'Tablet, laptop or PC. Card terminal optional.' },
        ]}
      />

      <Section id="layout" kicker="Layout" title="The POS at a glance">
        <p>
          The POS is split into three regions: the menu (left), the active cart (right) and the live order queue along
          the top. New WhatsApp orders appear in the queue with a green chat badge.
        </p>
        <Screenshot
          variant="browser"
          url="app.beepbite.io/home"
          alt="POS interface showing the menu, the cart and the live queue with a mix of in-store and WhatsApp orders."
          caption="POS layout — drop the real screenshot in /public/docs/pos-layout.png"
        />
      </Section>

      <Section id="take-order" kicker="Workflow" title="Take an in-store order">
        <Steps>
          <Step title="Pick the items">
            Tap items from the menu grid. Use the search field for long menus, or filter by category.
          </Step>
          <Step title="Apply modifiers">
            Tap an item in the cart to add modifiers (e.g. extra cheese, no onion) or notes for the kitchen.
          </Step>
          <Step title="Take payment">
            Tap <strong>Pay</strong>. Choose card, cash or contactless. The receipt prints (or emails) automatically.
          </Step>
          <Step title="Send to kitchen">
            The order moves to the queue with status <strong>Cooking</strong>. The kitchen sees it in real time.
          </Step>
        </Steps>
      </Section>

      <Section id="whatsapp-orders" kicker="Channels" title="Handle WhatsApp orders in the same queue">
        <p>
          When a customer orders via WhatsApp, the order appears at the top of the queue with a green chat icon. It
          works exactly like an in-store order: confirm, prepare, then mark ready.
        </p>
        <Screenshot
          variant="plain"
          alt="The order queue with a WhatsApp order highlighted, showing the customer's name, items and total."
          caption="WhatsApp orders show the customer's WhatsApp name and number"
          ratio="16/9"
        />
        <Callout tone="info" title="Auto pickup notification">
          When you mark a WhatsApp order as <strong>Ready</strong>, the customer receives a branded WhatsApp message
          immediately. No more lost buzzers.
        </Callout>
      </Section>

      <Section id="refunds" kicker="Edge cases" title="Refunds, voids and reopening orders">
        <p>
          Mistakes happen. The POS supports three correction flows:
        </p>
        <KeyValueList
          items={[
            { label: 'Void', value: 'Cancels an order before payment. No record on the receipt.' },
            { label: 'Refund', value: 'Reverses a paid order. Generates a refund receipt and adjusts daily totals.' },
            { label: 'Reopen', value: 'Brings a closed order back into the queue if you need to add items.' },
          ]}
        />
        <Callout tone="warn" title="Refund permissions">
          By default only Managers can issue refunds. Change this under{' '}
          <strong>Settings → Team → Permissions</strong>.
        </Callout>
      </Section>

      <Section id="end-of-day" kicker="Closing" title="End-of-day reconciliation">
        <p>
          At the end of service, run an <strong>End-of-day report</strong> from the POS menu. You'll see total takings
          per channel, expected cash in the drawer and a breakdown of refunds.
        </p>
        <Screenshot
          variant="browser"
          url="app.beepbite.io/reports/end-of-day"
          alt="The end-of-day report showing channel splits, expected cash and refund summary."
          caption="End-of-day report — drop the real screenshot in /public/docs/eod.png"
        />
      </Section>

      <PrevNext prev={prev} next={next} />
    </DocsLayout>
  );
};

export default POSOverview;
